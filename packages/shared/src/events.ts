/** Eventos emitidos pelo cliente para o servidor */
export const ClientEvent = {
  createRoom: 'room:create',
  joinRoom: 'room:join',
  leaveRoom: 'room:leave',
  toggleMute: 'user:mute',
  startScreenShare: 'screen:start',
  stopScreenShare: 'screen:stop',
  requestStopScreenShare: 'screen:request-stop',
  signaling: 'signaling:relay',
  ping: 'ping',
} as const;

export type ClientEvent = (typeof ClientEvent)[keyof typeof ClientEvent];

/** Eventos emitidos pelo servidor para os clientes */
export const ServerEvent = {
  roomCreated: 'room:created',
  roomJoined: 'room:joined',
  roomLeft: 'room:left',
  roomFull: 'room:full',
  roomNotFound: 'room:not-found',
  userJoined: 'user:joined',
  userLeft: 'user:left',
  userMuted: 'user:muted',
  screenShared: 'screen:shared',
  screenStopped: 'screen:stopped',
  screenShareDenied: 'screen:share-denied',
  screenShareRequested: 'screen:requested',
  signaling: 'signaling:relay',
  error: 'error',
} as const;

export type ServerEvent = (typeof ServerEvent)[keyof typeof ServerEvent];

/** Tipos de mensagens de signaling trocadas entre peers via servidor */
export const SignalType = {
  offer: 'offer',
  answer: 'answer',
  iceCandidate: 'ice-candidate',
} as const;

export type SignalType = (typeof SignalType)[keyof typeof SignalType];
