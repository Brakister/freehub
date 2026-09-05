import { MAX_NICKNAME_LENGTH, MIN_NICKNAME_LENGTH } from './constants';

export const isValidNickname = (nickname: string): boolean => {
  const trimmed = nickname.trim();
  return trimmed.length >= MIN_NICKNAME_LENGTH && trimmed.length <= MAX_NICKNAME_LENGTH;
};

export const normalizeNickname = (nickname: string): string => nickname.trim();

export const isValidRoomName = (roomName: string): boolean => {
  const trimmed = roomName.trim();
  return trimmed.length >= 1 && trimmed.length <= 48;
};

export const isRoomId = (roomId: string): boolean => /^[A-Z0-9]{6}$/.test(roomId);
