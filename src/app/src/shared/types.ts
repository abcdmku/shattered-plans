export type ViewName = 'boot' | 'auth' | 'lobby' | 'room' | 'game';

export interface UserSnapshot {
  id: string;
  displayName: string;
}

export interface ChatMessage {
  scope: string;
  senderId: number;
  senderName: string;
  message: string;
  timestamp: number;
}

export interface PlayerPresence {
  id: string;
  userId: number;
  displayName: string;
  connected: boolean;
  roomId: string | null;
}

export interface RoomSummary {
  id: string;
  title: string;
  ownerName: string;
  playerCount: number;
  maxPlayers: number;
  canSpectate: boolean;
  isPublic: boolean;
  status: string;
  member: boolean;
  invited: boolean;
  requested: boolean;
}

export interface RoomMember {
  id: string;
  userId: number;
  displayName: string;
  connected: boolean;
}

export interface RoomOptionsSnapshot {
  maxHumanPlayers: number;
  aiPlayers: number;
  turnLengthIndex: number;
  gameType: string;
  galaxySize: string;
  classicRuleset: boolean;
  allowSpectate: boolean;
  accessMode: string;
}

export interface RoomDetail {
  id: string;
  ownerSessionId: string | null;
  ownerName: string;
  members: RoomMember[];
  invitations: RoomMember[];
  joinRequests: RoomMember[];
  options: RoomOptionsSnapshot;
  started: boolean;
  canSpectate: boolean;
  messages: ChatMessage[];
}

export interface LobbySnapshot {
  players: PlayerPresence[];
  rooms: RoomSummary[];
  messages: ChatMessage[];
}

export interface GameSummary {
  id: string;
  turn: number;
  phase: string;
  playerName: string;
  boardLabel: string;
  waitingOn: number;
}

export interface GamePlayer {
  index: number;
  name: string;
  color: number;
  accentColor: number;
  defeated: boolean;
  resigned: boolean;
  researchPoints: number[];
  allies: boolean[];
  incomingPactOffersBitmap: number;
  outgoingPactOffersBitmap: number;
  stats: string[];
}

export interface SystemSnapshot {
  index: number;
  name: string;
  x: number;
  y: number;
  ownerIndex: number;
  garrison: number;
  minimumGarrison: number;
  hasDefensiveNet: boolean;
  resources: number[];
  neighbors: number[];
  score: number;
  type: number;
}

export interface TannhauserSnapshot {
  fromIndex: number;
  toIndex: number;
  turnsLeft: number;
}

export interface ForceSnapshot {
  id: string;
  playerIndex: number;
  unified: boolean;
  capitalIndex: number;
  systems: number[];
  fleetProduction: number;
  fleetsAvailableToBuild: number;
  surplusResources: number[];
  surplusResourceRanks: number[];
}

export interface BuildOrderSnapshot {
  systemIndex: number;
  quantity: number;
}

export interface MoveOrderSnapshot {
  sourceIndex: number;
  targetIndex: number;
  quantity: number;
}

export interface ProjectOrderSnapshot {
  type: string;
  sourceIndex: number | null;
  targetIndex: number | null;
}

export interface OrdersSnapshot {
  buildOrders: BuildOrderSnapshot[];
  moveOrders: MoveOrderSnapshot[];
  projectOrders: ProjectOrderSnapshot[];
}

export interface VictorySnapshot {
  leaders: number[];
  victors: number[];
}

export interface CombatantSnapshot {
  playerIndex: number | null;
  sourceIndex: number | null;
  fleetsAtStart: number;
  fleetsDestroyed: number;
  fleetsRetreated: number;
}

export interface ResolvedEventSnapshot {
  kind: 'MOVE' | 'RETREAT' | 'COLLAPSE' | 'BUILD' | 'PROJECT' | 'COMBAT';
  playerIndex: number | null;
  sourceIndex: number | null;
  targetIndex: number | null;
  systemIndex: number | null;
  quantity: number;
  projectType: string | null;
  ownerAtCombatStart: number | null;
  combatants: CombatantSnapshot[];
  victorIndex: number | null;
  fleetsAtEnd: number;
  kills: number;
  garrisonAtCollapse: number;
  minimumGarrisonAtCollapse: number;
}

export interface GameDetail {
  id: string;
  kind: string;
  spectator: boolean;
  localPlayerIndex: number | null;
  endedTurn: boolean;
  turnNumber: number;
  turnName: string;
  turnTicksLeft: number;
  turnDurationTicks: number;
  ended: boolean;
  winnerIndex: number | null;
  waitingOn: number;
  gameType: string;
  galaxySize: string;
  classicRuleset: boolean;
  players: GamePlayer[];
  systems: SystemSnapshot[];
  tannhauserLinks: TannhauserSnapshot[];
  forces: ForceSnapshot[];
  pendingOrders: OrdersSnapshot;
  messages: ChatMessage[];
  eventLog: string[];
  resolvedEvents: ResolvedEventSnapshot[];
  victory: VictorySnapshot;
}

export interface SessionSnapshot {
  view: ViewName;
  user: UserSnapshot | null;
  room: RoomSummary | null;
  game: GameSummary | null;
  notices: string[];
  lobby: LobbySnapshot | null;
  roomDetail: RoomDetail | null;
  gameDetail: GameDetail | null;
}

export interface SocketEnvelope<T = unknown> {
  type: string;
  payload: T;
}
