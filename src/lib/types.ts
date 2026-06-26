export type ThemeMode = 'light' | 'dark' | 'system';

export interface LoginInput {
  url: string;
  username: string;
  password: string;
  name: string;
}

export interface ServerProfile {
  id: string;
  name: string;
  url: string;
  username: string;
  accessToken: string;
  userId: string;
  lastLoginAt: string;
}

export interface AppState {
  profiles: ServerProfile[];
  activeProfileId?: string;
  theme: ThemeMode;
  mpvPath: string;
}

export interface EmbyImageTags {
  Primary?: string;
  Backdrop?: string;
  Logo?: string;
  Thumb?: string;
}

export interface MediaSource {
  Id: string;
  Name?: string;
  Path?: string;
  Container?: string;
  Size?: number;
  Bitrate?: number;
  VideoType?: string;
  Protocol?: string;
}

export interface EmbyUserData {
  Played?: boolean;
  IsFavorite?: boolean;
  PlaybackPositionTicks?: number;
  PlayCount?: number;
}

export interface EmbyItem {
  Id: string;
  Name: string;
  Type: 'Movie' | 'Series' | 'Episode' | 'Video' | string;
  CollectionType?: string;
  Overview?: string;
  ProductionYear?: number;
  RunTimeTicks?: number;
  ImageTags?: EmbyImageTags;
  BackdropImageTags?: string[];
  ParentBackdropItemId?: string;
  ParentId?: string;
  SeriesId?: string;
  SeriesName?: string;
  SeriesPrimaryImageTag?: string;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  ChildCount?: number;
  RecursiveItemCount?: number;
  CommunityRating?: number;
  PremiereDate?: string;
  DateCreated?: string;
  UserData?: EmbyUserData;
  MediaSources?: MediaSource[];
  Genres?: string[];
  matchedEpisodes?: number;
}

export interface EmbyItemsResponse {
  Items: EmbyItem[];
  TotalRecordCount: number;
  StartIndex: number;
}

export interface ViewResponse {
  Items: EmbyItem[];
}
