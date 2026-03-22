import type { GamePlayer, ProjectOrderSnapshot } from './types';

export const GAME_TYPE_OPTIONS = [
  { value: 'CONQUEST', label: 'Conquest' },
  { value: 'CAPTURE_AND_HOLD', label: 'Capture & Hold' },
  { value: 'POINTS', label: 'Points' },
  { value: 'DERELICTS', label: 'Derelicts' }
] as const;

export const GALAXY_SIZE_OPTIONS = [
  { value: 'SMALL', label: 'Small' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'LARGE', label: 'Large' },
  { value: 'HUGE', label: 'Huge' }
] as const;

export const ACCESS_MODE_OPTIONS = [
  { value: 'INVITE_ONLY', label: 'Invite only' },
  { value: 'OPEN', label: 'Open' }
] as const;

export const TURN_LENGTH_OPTIONS = [
  { value: 0, label: '15s' },
  { value: 1, label: '9s' },
  { value: 2, label: '6s' },
  { value: 3, label: '4.5s' },
  { value: 4, label: '3s' },
  { value: 5, label: '2.25s' },
  { value: 6, label: '1.5s' }
] as const;

export const PROJECT_LABELS: Record<string, string> = {
  METAL: 'Defense Net',
  BIOMASS: 'Terraform',
  ENERGY: 'Stellar Bomb',
  EXOTICS: 'Tannhauser'
};

export const PROJECT_SHORT_LABELS: Record<string, string> = {
  METAL: 'DN',
  BIOMASS: 'TF',
  ENERGY: 'SB',
  EXOTICS: 'TH'
};

export const RESOURCE_LABELS = ['Metal', 'Biomass', 'Energy', 'Exotics'];

export const STAT_LABELS = [
  'Max fleet size',
  'Ships destroyed',
  'Ships lost',
  'Avg move size',
  'Max production',
  'Ships built',
  'Projects used',
  'Research wasted',
  'Attacks won',
  'Attacks lost',
  'Defences won',
  'Defences lost',
  'Efficiency',
  'Fluidity',
  'Aggressiveness',
  'Solidity'
] as const;

export function formatLabel(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map(part => (part ? `${part[0]!.toUpperCase()}${part.slice(1)}` : part))
    .join(' ');
}

export function getOptionLabel(options: ReadonlyArray<{ value: string | number; label: string }>, value: string | number): string {
  return options.find(option => option.value === value)?.label ?? String(value);
}

export function colorFromInt(color: number): string {
  return `#${Math.max(0, color).toString(16).padStart(6, '0')}`;
}

export function playerAccent(player?: GamePlayer | null): string {
  return player ? colorFromInt(player.accentColor) : '#9aa6bf';
}

export function playerBaseColor(player?: GamePlayer | null): string {
  return player ? colorFromInt(player.color) : '#445065';
}

export function isBitSet(bitmap: number, index: number): boolean {
  return (bitmap & (1 << index)) !== 0;
}

export function sortMembersByName<T extends { displayName: string }>(members: T[]): T[] {
  return [...members].sort((left, right) => left.displayName.localeCompare(right.displayName));
}

export function projectLabel(project: ProjectOrderSnapshot): string {
  return PROJECT_LABELS[project.type] ?? formatLabel(project.type);
}

export function shortProjectLabel(type: string): string {
  return PROJECT_SHORT_LABELS[type] ?? formatLabel(type).slice(0, 2).toUpperCase();
}
