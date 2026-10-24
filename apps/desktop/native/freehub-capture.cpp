// freehub-capture.exe
//
// Helper nativo do Freehub para captura de áudio do sistema com exclusão (ou
// inclusão) de uma árvore de processos. Usa o "process loopback" do WASAPI,
// disponível no Windows 10 2004+.
//
// Modos:
//   --exclude-pid <pid>   captura tudo, menos o processo e seus filhos
//   --include-pid <pid>   captura apenas o processo e seus filhos
//   --list-sessions       lista processos com sessão de áudio ativa
//   --list-windows        lista processos com janelas visíveis
//   --list-window-bounds  lista retângulos de janelas visíveis
//
// Saída de áudio: PCM s16le, 48 kHz, 2 canais, em stdout.
// Prontidão: a linha "READY" em stderr depois que o cliente foi iniciado.
// Código de saída 3: o Windows recusou a ativação do process loopback.

#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif

#include <windows.h>

#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <audiopolicy.h>
#include <dwmapi.h>
#include <mmdeviceapi.h>

#include <wrl/client.h>
#include <wrl/implements.h>

#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fcntl.h>
#include <io.h>
#include <map>
#include <set>
#include <string>
#include <thread>
#include <vector>

using Microsoft::WRL::ComPtr;

namespace {

constexpr UINT32 kSampleRate = 48000;
constexpr UINT16 kChannels = 2;
constexpr UINT16 kBitsPerSample = 16;
constexpr DWORD kExitUnsupported = 3;

std::string ToUtf8(const std::wstring& value) {
  if (value.empty()) return {};
  const int size = WideCharToMultiByte(CP_UTF8, 0, value.data(),
                                       static_cast<int>(value.size()), nullptr, 0,
                                       nullptr, nullptr);
  if (size <= 0) return {};
  std::string out(static_cast<size_t>(size), '\0');
  WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()),
                      out.data(), size, nullptr, nullptr);
  return out;
}

std::string CleanField(const std::string& value) {
  std::string out;
  out.reserve(value.size());
  for (const char c : value) {
    if (c == '\t' || c == '\r' || c == '\n') {
      out.push_back(' ');
    } else {
      out.push_back(c);
    }
  }
  return out;
}

void PrintRow(DWORD pid, const std::wstring& name, const std::wstring& path) {
  const std::string line = std::to_string(pid) + "\t" + CleanField(ToUtf8(name)) +
                           "\t" + CleanField(ToUtf8(path)) + "\n";
  fwrite(line.data(), 1, line.size(), stdout);
}

std::wstring ProcessPath(DWORD pid) {
  if (pid == 0) return {};
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!process) return {};
  WCHAR buffer[32768];
  DWORD length = static_cast<DWORD>(std::size(buffer));
  std::wstring result;
  if (QueryFullProcessImageNameW(process, 0, buffer, &length)) {
    result.assign(buffer, length);
  }
  CloseHandle(process);
  return result;
}

// Nome amigável do executável, do bloco de versão do próprio arquivo. Cai
// para o nome do arquivo quando o programa não publica versão.
std::wstring ProcessDisplayName(const std::wstring& path) {
  if (path.empty()) return {};
  DWORD ignored = 0;
  const DWORD size = GetFileVersionInfoSizeW(path.c_str(), &ignored);
  if (size == 0) return {};
  std::vector<BYTE> data(size);
  if (!GetFileVersionInfoW(path.c_str(), 0, size, data.data())) return {};

  WORD language = 0x0409;
  WORD codepage = 0x04b0;
  struct Translation {
    WORD language;
    WORD codepage;
  };
  Translation* translations = nullptr;
  UINT translationBytes = 0;
  if (VerQueryValueW(data.data(), L"\\VarFileInfo\\Translation",
                     reinterpret_cast<void**>(&translations),
                     &translationBytes) &&
      translationBytes >= sizeof(Translation)) {
    language = translations[0].language;
    codepage = translations[0].codepage;
  }

  const wchar_t* keys[] = {L"ProductName", L"FileDescription", L"InternalName"};
  for (const wchar_t* key : keys) {
    WCHAR query[192];
    swprintf_s(query, L"\\StringFileInfo\\%04x%04x\\%s", language, codepage, key);
    WCHAR* value = nullptr;
    UINT valueBytes = 0;
    if (VerQueryValueW(data.data(), query, reinterpret_cast<void**>(&value),
                       &valueBytes) &&
        value && value[0] != L'\0') {
      std::wstring result(value);
      if (!result.empty()) return result;
    }
  }
  return {};
}

std::wstring BaseName(const std::wstring& path) {
  const size_t slash = path.find_last_of(L"\\/");
  return slash == std::wstring::npos ? path : path.substr(slash + 1);
}

const std::wstring& CachedName(DWORD pid, const std::wstring& path,
                               std::map<DWORD, std::wstring>& names) {
  auto it = names.find(pid);
  if (it != names.end()) return it->second;
  std::wstring name = ProcessDisplayName(path);
  if (name.empty()) name = BaseName(path);
  if (name.empty()) name = L"Programa";
  return names.emplace(pid, std::move(name)).first->second;
}

// ---------------------------------------------------------------------------
// Process loopback
// ---------------------------------------------------------------------------

class ActivationHandler final
    : public Microsoft::WRL::RuntimeClass<
          Microsoft::WRL::RuntimeClassFlags<Microsoft::WRL::ClassicCom>,
          Microsoft::WRL::FtmBase,
          IActivateAudioInterfaceCompletionHandler> {
 public:
  ActivationHandler() : done_(CreateEventW(nullptr, TRUE, FALSE, nullptr)) {}
  ~ActivationHandler() {
    if (done_) CloseHandle(done_);
  }

  STDMETHODIMP ActivateCompleted(
      IActivateAudioInterfaceAsyncOperation* /*operation*/) override {
    if (done_) SetEvent(done_);
    return S_OK;
  }

  HANDLE done() const { return done_; }

 private:
  HANDLE done_ = nullptr;
};

HRESULT ActivateProcessLoopback(DWORD targetPid, bool include,
                                ComPtr<IAudioClient>& audioClient) {
  AUDIOCLIENT_ACTIVATION_PARAMS activation = {};
  activation.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  activation.ProcessLoopbackParams.TargetProcessId = targetPid;
  activation.ProcessLoopbackParams.ProcessLoopbackMode =
      include ? PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
              : PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;

  PROPVARIANT activateParams = {};
  activateParams.vt = VT_BLOB;
  activateParams.blob.cbSize = sizeof(activation);
  activateParams.blob.pBlobData = reinterpret_cast<BYTE*>(&activation);

  auto handler = Microsoft::WRL::Make<ActivationHandler>();
  if (!handler || !handler->done()) return E_OUTOFMEMORY;

  ComPtr<IActivateAudioInterfaceAsyncOperation> operation;
  HRESULT hr = ActivateAudioInterfaceAsync(
      VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient),
      &activateParams, handler.Get(), operation.GetAddressOf());
  if (FAILED(hr)) return hr;

  const DWORD wait = WaitForSingleObject(handler->done(), 15000);
  if (wait != WAIT_OBJECT_0) return HRESULT_FROM_WIN32(ERROR_TIMEOUT);

  HRESULT activationResult = E_FAIL;
  ComPtr<IUnknown> unknown;
  hr = operation->GetActivateResult(&activationResult, unknown.GetAddressOf());
  if (FAILED(hr)) return hr;
  if (FAILED(activationResult)) return activationResult;
  return unknown.CopyTo(audioClient.GetAddressOf());
}

void WatchParent(DWORD parentPid, HANDLE wake) {
  if (parentPid == 0) return;
  HANDLE parent = OpenProcess(SYNCHRONIZE, FALSE, parentPid);
  if (!parent) return;
  WaitForSingleObject(parent, INFINITE);
  CloseHandle(parent);
  if (wake) SetEvent(wake);
}

void WatchStdin(HANDLE wake) {
  char buffer[512];
  while (fread(buffer, 1, sizeof(buffer), stdin) > 0) {
    // O conteúdo não importa: o fechamento do pipe é o sinal de parada.
  }
  if (wake) SetEvent(wake);
}

std::atomic<bool> g_ctrlC{false};
HANDLE g_wake = nullptr;

BOOL WINAPI ConsoleHandler(DWORD type) {
  if (type == CTRL_C_EVENT || type == CTRL_BREAK_EVENT ||
      type == CTRL_CLOSE_EVENT) {
    g_ctrlC.store(true);
    if (g_wake) SetEvent(g_wake);
    return TRUE;
  }
  return FALSE;
}

int RunCapture(DWORD targetPid, bool include, DWORD parentPid) {
  if (targetPid == 0) {
    fprintf(stderr, "freehub-capture: pid inválido\n");
    return 1;
  }

  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr) && hr != RPC_E_CHANGED_MODE) {
    fprintf(stderr, "freehub-capture: CoInitializeEx falhou (0x%08lx)\n", hr);
    return 2;
  }

  ComPtr<IAudioClient> client;
  hr = ActivateProcessLoopback(targetPid, include, client);
  if (FAILED(hr)) {
    fprintf(stderr,
            "freehub-capture: process loopback indisponível (0x%08lx)\n", hr);
    CoUninitialize();
    return kExitUnsupported;
  }

  WAVEFORMATEX format = {};
  format.wFormatTag = WAVE_FORMAT_PCM;
  format.nChannels = kChannels;
  format.nSamplesPerSec = kSampleRate;
  format.wBitsPerSample = kBitsPerSample;
  format.nBlockAlign = kChannels * kBitsPerSample / 8;
  format.nAvgBytesPerSec = kSampleRate * format.nBlockAlign;
  format.cbSize = 0;

  // AUTOCONVERTPCM deixa o próprio motor de áudio entregar o formato fixo
  // acima, mesmo que o mix nativo do Windows esteja em float.
  const DWORD flags = AUDCLNT_STREAMFLAGS_LOOPBACK |
                      AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
                      AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM;
  hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 0, 0, &format,
                          nullptr);
  if (FAILED(hr)) {
    fprintf(stderr,
            "freehub-capture: Initialize falhou (0x%08lx)\n", hr);
    CoUninitialize();
    return kExitUnsupported;
  }

  ComPtr<IAudioCaptureClient> capture;
  hr = client->GetService(IID_PPV_ARGS(capture.GetAddressOf()));
  if (FAILED(hr)) {
    fprintf(stderr, "freehub-capture: GetService falhou (0x%08lx)\n", hr);
    CoUninitialize();
    return 2;
  }

  HANDLE sampleReady = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  g_wake = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  if (!sampleReady || !g_wake) {
    if (sampleReady) CloseHandle(sampleReady);
    if (g_wake) CloseHandle(g_wake);
    CoUninitialize();
    return 2;
  }

  hr = client->SetEventHandle(sampleReady);
  if (FAILED(hr)) {
    fprintf(stderr, "freehub-capture: SetEventHandle falhou (0x%08lx)\n", hr);
    CloseHandle(sampleReady);
    CloseHandle(g_wake);
    CoUninitialize();
    return 2;
  }

  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);

  SetConsoleCtrlHandler(ConsoleHandler, TRUE);
  std::thread(WatchStdin, g_wake).detach();
  std::thread(WatchParent, parentPid, g_wake).detach();

  hr = client->Start();
  if (FAILED(hr)) {
    fprintf(stderr, "freehub-capture: Start falhou (0x%08lx)\n", hr);
    CloseHandle(sampleReady);
    CloseHandle(g_wake);
    CoUninitialize();
    return 2;
  }

  fprintf(stderr, "READY\n");
  fflush(stderr);

  const HANDLE handles[2] = {sampleReady, g_wake};
  bool running = true;
  while (running && !g_ctrlC.load()) {
    const DWORD wait = WaitForMultipleObjects(2, handles, FALSE, 250);
    if (wait == WAIT_OBJECT_0 + 1) break;
    if (wait == WAIT_FAILED) break;

    UINT32 packetFrames = 0;
    while (SUCCEEDED(capture->GetNextPacketSize(&packetFrames)) &&
           packetFrames > 0) {
      BYTE* data = nullptr;
      UINT32 frames = 0;
      DWORD bufferFlags = 0;
      UINT64 devicePosition = 0;
      UINT64 qpcPosition = 0;
      hr = capture->GetBuffer(&data, &frames, &bufferFlags, &devicePosition,
                              &qpcPosition);
      if (FAILED(hr)) {
        running = false;
        break;
      }

      if (frames > 0 && !(bufferFlags & AUDCLNT_BUFFERFLAGS_SILENT) && data) {
        const size_t bytes = static_cast<size_t>(frames) * format.nBlockAlign;
        if (bytes > 0 && fwrite(data, 1, bytes, stdout) != bytes) {
          running = false;
        }
        fflush(stdout);
      }
      capture->ReleaseBuffer(frames);
    }
  }

  client->Stop();
  SetConsoleCtrlHandler(ConsoleHandler, FALSE);
  CloseHandle(sampleReady);
  CloseHandle(g_wake);
  g_wake = nullptr;
  CoUninitialize();
  return 0;
}

// ---------------------------------------------------------------------------
// Listagens
// ---------------------------------------------------------------------------

void ListAudioSessions() {
  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr) && hr != RPC_E_CHANGED_MODE) return;

  ComPtr<IMMDeviceEnumerator> enumerator;
  hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                        IID_PPV_ARGS(enumerator.GetAddressOf()));
  if (FAILED(hr)) {
    CoUninitialize();
    return;
  }

  ComPtr<IMMDevice> device;
  hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole,
                                           device.GetAddressOf());
  if (FAILED(hr)) {
    CoUninitialize();
    return;
  }

  ComPtr<IAudioSessionManager2> manager;
  hr = device->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr,
                        reinterpret_cast<void**>(manager.GetAddressOf()));
  if (FAILED(hr)) {
    CoUninitialize();
    return;
  }

  ComPtr<IAudioSessionEnumerator> sessions;
  hr = manager->GetSessionEnumerator(sessions.GetAddressOf());
  if (FAILED(hr)) {
    CoUninitialize();
    return;
  }

  int count = 0;
  sessions->GetCount(&count);
  std::set<DWORD> seen;
  std::map<DWORD, std::wstring> names;

  for (int i = 0; i < count; ++i) {
    ComPtr<IAudioSessionControl> control;
    if (FAILED(sessions->GetSession(i, control.GetAddressOf()))) continue;

    AudioSessionState state = AudioSessionStateExpired;
    if (FAILED(control->GetState(&state)) || state != AudioSessionStateActive) {
      continue;
    }

    ComPtr<IAudioSessionControl2> control2;
    if (FAILED(control.As(&control2))) continue;

    DWORD pid = 0;
    if (FAILED(control2->GetProcessId(&pid)) || pid == 0) continue;
    if (!seen.insert(pid).second) continue;

    const std::wstring path = ProcessPath(pid);
    if (path.empty()) continue;
    PrintRow(pid, CachedName(pid, path, names), path);
  }

  fflush(stdout);
  CoUninitialize();
}

struct WindowEnumContext {
  bool includeBounds = false;
  std::set<DWORD> seen;
  std::map<DWORD, std::wstring> names;
};

BOOL CALLBACK EnumWindowProc(HWND window, LPARAM param) {
  auto* context = reinterpret_cast<WindowEnumContext*>(param);
  if (!context) return TRUE;
  if (!IsWindowVisible(window)) return TRUE;
  if (GetWindowTextLengthW(window) == 0) return TRUE;

  const LONG exStyle = GetWindowLongW(window, GWL_EXSTYLE);
  if (exStyle & WS_EX_TOOLWINDOW) return TRUE;

  DWORD cloaked = 0;
  if (SUCCEEDED(DwmGetWindowAttribute(window, DWMWA_CLOAKED, &cloaked,
                                      sizeof(cloaked))) &&
      cloaked != 0) {
    return TRUE;
  }

  RECT rect = {};
  if (!GetWindowRect(window, &rect)) return TRUE;
  if (rect.right - rect.left < 2 || rect.bottom - rect.top < 2) return TRUE;

  DWORD pid = 0;
  GetWindowThreadProcessId(window, &pid);
  if (pid == 0) return TRUE;

  const std::wstring path = ProcessPath(pid);
  if (path.empty()) return TRUE;

  if (!context->includeBounds) {
    if (!context->seen.insert(pid).second) return TRUE;
    PrintRow(pid, CachedName(pid, path, context->names), path);
  } else {
    const std::string line =
        std::to_string(pid) + "\t" + std::to_string(rect.left) + "\t" +
        std::to_string(rect.top) + "\t" +
        std::to_string(rect.right - rect.left) + "\t" +
        std::to_string(rect.bottom - rect.top) + "\t" +
        CleanField(ToUtf8(CachedName(pid, path, context->names))) + "\t" +
        CleanField(ToUtf8(path)) + "\n";
    fwrite(line.data(), 1, line.size(), stdout);
  }
  return TRUE;
}

void ListWindows(bool includeBounds) {
  WindowEnumContext context;
  context.includeBounds = includeBounds;
  EnumWindows(EnumWindowProc, reinterpret_cast<LPARAM>(&context));
  fflush(stdout);
}

void PrintUsage() {
  fprintf(stderr,
          "uso: freehub-capture --exclude-pid <pid> [--parent-pid <pid>]\n"
          "     freehub-capture --include-pid <pid> [--parent-pid <pid>]\n"
          "     freehub-capture --list-sessions\n"
          "     freehub-capture --list-windows\n"
          "     freehub-capture --list-window-bounds\n");
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  _setmode(_fileno(stdout), _O_BINARY);
  _setmode(_fileno(stderr), _O_BINARY);

  DWORD targetPid = 0;
  DWORD parentPid = 0;
  bool include = false;
  bool capture = false;
  bool listSessions = false;
  bool listWindows = false;
  bool listBounds = false;

  for (int i = 1; i < argc; ++i) {
    const std::wstring arg = argv[i];
    if (arg == L"--exclude-pid" || arg == L"--include-pid") {
      if (i + 1 >= argc) {
        PrintUsage();
        return 1;
      }
      targetPid = static_cast<DWORD>(wcstoul(argv[++i], nullptr, 10));
      include = arg == L"--include-pid";
      capture = true;
    } else if (arg == L"--parent-pid") {
      if (i + 1 >= argc) {
        PrintUsage();
        return 1;
      }
      parentPid = static_cast<DWORD>(wcstoul(argv[++i], nullptr, 10));
    } else if (arg == L"--list-sessions") {
      listSessions = true;
    } else if (arg == L"--list-windows") {
      listWindows = true;
    } else if (arg == L"--list-window-bounds") {
      listBounds = true;
    } else if (arg == L"--help" || arg == L"-h" || arg == L"/?") {
      PrintUsage();
      return 0;
    } else {
      fprintf(stderr, "freehub-capture: argumento desconhecido\n");
      PrintUsage();
      return 1;
    }
  }

  if (listSessions) {
    ListAudioSessions();
    return 0;
  }
  if (listWindows) {
    ListWindows(false);
    return 0;
  }
  if (listBounds) {
    ListWindows(true);
    return 0;
  }
  if (capture) return RunCapture(targetPid, include, parentPid);

  PrintUsage();
  return 1;
}
