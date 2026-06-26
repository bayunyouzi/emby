import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownAZ,
  ArrowUpAZ,
  Check,
  Copy,
  Film,
  Grid2X2,
  Grid3X3,
  Library,
  Loader2,
  MonitorPlay,
  Play,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  SquareArrowOutUpRight,
  Star,
  Tv,
  Wifi,
  X,
} from 'lucide-react';
import {
  MediaCommunitySkin,
  MediaOutlet,
  MediaPlayer,
} from '@vidstack/react';
import { TextTrack, type MediaPlayerElement } from 'vidstack';
import type {
  AppState,
  EmbyItem,
  EmbyItemsResponse,
  EmbyMediaStream,
  LoginInput,
  PlaybackInfoResponse,
  PlaybackMediaSource,
  ServerProfile,
  ThemeMode,
  ViewResponse,
} from './lib/types';
import { bitrateToText, bytesToSize, getErrorMessage, ticksToTime } from './lib/format';

type Screen = 'home' | 'settings';
type LoadState = 'idle' | 'loading' | 'error' | 'ready';
type SortOrder = 'Ascending' | 'Descending';
type SortOption = 'DateCreated' | 'PremiereDate' | 'SortName' | 'CommunityRating' | 'RunTimeTicks';
type FilterOption = 'all' | 'Series' | 'Movie' | 'Video' | 'unplayed' | 'favorite';
type DensityOption = 'comfortable' | 'compact';
type HomeMode = 'library' | 'latest' | 'resume' | 'nextup';
type ResultGroup = { key: string; title: string; description: string; items: EmbyItem[] };
type PlayerSubtitle = {
  id: string;
  label: string;
  language: string;
  src: string;
  isDefault: boolean;
  codec?: string;
  isForced?: boolean;
};
type PlayerSession = {
  item: EmbyItem;
  sourceUrl: string;
  posterUrl: string;
  mediaSource: PlaybackMediaSource;
  subtitles: PlayerSubtitle[];
  unsupportedSubtitleLabels: string[];
};

const STORAGE_KEY = 'aurora-emby-web-state';
const defaultLogin: LoginInput = {
  url: 'https://zhuixin.8622368.xyz:443',
  username: 'sx_40f9adf6e0e84d9c83c98f15889d8127',
  password: 'SzCC01FE29E99!',
  name: '追新 Emby',
};
const initialState: AppState = {
  profiles: [],
  activeProfileId: undefined,
  theme: 'system',
};
const playerTranslations = {
  Play: '播放',
  Pause: '暂停',
  Mute: '静音',
  Unmute: '取消静音',
  Audio: '音轨',
  Speed: '速度',
  Normal: '正常',
  Quality: '清晰度',
  Auto: '自动',
  Settings: '设置',
  Captions: '字幕',
  Off: '关闭',
  Chapters: '章节',
  'Seek Forward': '快进',
  'Seek Backward': '快退',
  'Closed-Captions On': '字幕开',
  'Closed-Captions Off': '字幕关',
  'Enter Fullscreen': '进入全屏',
  'Exit Fullscreen': '退出全屏',
  'Enter PiP': '画中画',
  'Exit PiP': '退出画中画',
};

const sortOptions: { value: SortOption; label: string; emby: string }[] = [
  { value: 'DateCreated', label: '入库时间', emby: 'DateCreated,SortName' },
  { value: 'PremiereDate', label: '首播时间', emby: 'PremiereDate,SortName' },
  { value: 'SortName', label: '名称', emby: 'SortName' },
  { value: 'CommunityRating', label: '评分', emby: 'CommunityRating,SortName' },
  { value: 'RunTimeTicks', label: '时长', emby: 'RunTimeTicks,SortName' },
];

const filterOptions: { value: FilterOption; label: string; include?: string }[] = [
  { value: 'all', label: '全部', include: 'Movie,Series,Episode,Video' },
  { value: 'Series', label: '只看剧集', include: 'Series,Episode' },
  { value: 'Movie', label: '只看电影', include: 'Movie' },
  { value: 'Video', label: '只看视频', include: 'Video' },
  { value: 'unplayed', label: '未看完', include: 'Movie,Series,Episode,Video' },
  { value: 'favorite', label: '收藏', include: 'Movie,Series,Episode,Video' },
];

const homeModes: { value: HomeMode; label: string; description: string }[] = [
  { value: 'library', label: '媒体库', description: '完整浏览、搜索和排序' },
  { value: 'latest', label: '最新入库', description: '官方 Latest Items，适合追新' },
  { value: 'resume', label: '继续观看', description: '官方 Resume 列表，接着上次看' },
  { value: 'nextup', label: '下一集', description: '官方 Next Up，自动找下一集' },
];

function sanitizeServerUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) throw new Error('服务器地址不能为空');
  return trimmed.replace(/\/+$/, '');
}

function readStoredState(): AppState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState;
    const parsed = JSON.parse(raw) as Partial<AppState>;
    return {
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
      activeProfileId: parsed.activeProfileId,
      theme: parsed.theme || 'system',
    };
  } catch {
    return initialState;
  }
}

function writeStoredState(state: AppState) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function useTheme(theme: ThemeMode | undefined) {
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      root.dataset.theme = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme || 'light';
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
}

function getActiveProfile(state: AppState) {
  return state.profiles.find((profile) => profile.id === state.activeProfileId) || state.profiles[0];
}

async function loginToEmby(input: LoginInput) {
  const serverUrl = sanitizeServerUrl(input.url);
  const username = input.username.trim();
  const password = input.password;
  if (!username || !password) throw new Error('用户名和密码不能为空');

  const response = await fetch(`${serverUrl}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Emby-Authorization': 'MediaBrowser Client="Aurora Emby Web", Device="Browser", DeviceId="aurora-emby-web", Version="1.1.0"',
    },
    body: JSON.stringify({ Username: username, Pw: password }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`登录失败：${response.status} ${response.statusText}${text ? ` - ${text.slice(0, 160)}` : ''}`);
  }

  const data = await response.json() as { AccessToken?: string; User?: { Id?: string; Name?: string } };
  if (!data.AccessToken || !data.User?.Id) throw new Error('登录响应缺少 AccessToken 或 UserId');

  return {
    id: `${serverUrl}|${data.User.Id}`,
    name: input.name.trim() || data.User.Name || username,
    url: serverUrl,
    username,
    accessToken: data.AccessToken,
    userId: data.User.Id,
    lastLoginAt: new Date().toISOString(),
  } satisfies ServerProfile;
}

async function embyRequest<T>(profile: ServerProfile, path: string, init: RequestInit = {}) {
  const url = new URL(`${profile.url}${path}`);
  const headers = new Headers(init.headers);
  headers.set('X-Emby-Token', profile.accessToken);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(url.toString(), { ...init, headers });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Emby 请求失败：${response.status} ${response.statusText}${text ? ` - ${text.slice(0, 240)}` : ''}`);
  }
  if (response.status === 204) return null as T;
  return response.json() as Promise<T>;
}

function getStreamUrl(profile: ServerProfile, itemId: string, mediaSourceId?: string) {
  const url = new URL(`${profile.url}/Videos/${itemId}/stream`);
  url.searchParams.set('static', 'true');
  url.searchParams.set('api_key', profile.accessToken);
  if (mediaSourceId) url.searchParams.set('MediaSourceId', mediaSourceId);
  return url.toString();
}

function getImageUrl(profile: ServerProfile, input: { itemId: string; tag?: string; type?: string; width?: number }) {
  const type = input.type || 'Primary';
  const url = new URL(`${profile.url}/Items/${input.itemId}/Images/${type}`);
  url.searchParams.set('api_key', profile.accessToken);
  url.searchParams.set('quality', '90');
  if (input.width) url.searchParams.set('maxWidth', String(input.width));
  if (input.tag) url.searchParams.set('tag', input.tag);
  return url.toString();
}

function getSubtitleUrl(profile: ServerProfile, itemId: string, mediaSourceId: string, index: number, format: 'vtt' | 'srt' = 'vtt') {
  const url = new URL(`${profile.url}/Videos/${itemId}/${mediaSourceId}/Subtitles/${index}/Stream.${format}`);
  url.searchParams.set('api_key', profile.accessToken);
  return url.toString();
}

function buildItemQuery(input: { parentId?: string; searchTerm?: string; startIndex?: number; limit?: number; sortBy?: string; sortOrder?: SortOrder; includeItemTypes?: string; isPlayed?: boolean }) {
  const params = new URLSearchParams({
    Recursive: 'true',
    IncludeItemTypes: input.includeItemTypes || 'Movie,Series,Episode,Video',
    Fields: 'PrimaryImageAspectRatio,Overview,Genres,ProductionYear,RunTimeTicks,MediaSources,Path,DateCreated,PremiereDate,CommunityRating,SeriesInfo,ParentId,ParentIndexNumber,IndexNumber,UserData,RecursiveItemCount',
    SortBy: input.sortBy || 'DateCreated,SortName',
    SortOrder: input.sortOrder || 'Descending',
    StartIndex: String(input.startIndex || 0),
    Limit: String(input.limit || 80),
    EnableTotalRecordCount: 'true',
  });
  if (input.parentId) params.set('ParentId', input.parentId);
  if (input.searchTerm?.trim()) params.set('SearchTerm', input.searchTerm.trim());
  if (typeof input.isPlayed === 'boolean') params.set('IsPlayed', String(input.isPlayed));
  return params;
}

function fetchViews(profile: ServerProfile) {
  return embyRequest<ViewResponse>(profile, `/Users/${profile.userId}/Views`);
}

function fetchItems(profile: ServerProfile, input: { parentId?: string; searchTerm?: string; startIndex?: number; limit?: number; sortBy?: string; sortOrder?: SortOrder; includeItemTypes?: string; isPlayed?: boolean }) {
  const params = buildItemQuery(input);
  params.set('UserId', profile.userId);
  return embyRequest<EmbyItemsResponse>(profile, `/Items?${params.toString()}`);
}

async function fetchLatest(profile: ServerProfile, input: { parentId?: string; limit?: number; includeItemTypes?: string; isPlayed?: boolean; groupItems?: boolean }) {
  const params = new URLSearchParams({
    Fields: 'PrimaryImageAspectRatio,Overview,Genres,ProductionYear,RunTimeTicks,MediaSources,Path,DateCreated,PremiereDate,CommunityRating,SeriesInfo,ParentId,ParentIndexNumber,IndexNumber,UserData,RecursiveItemCount',
    IncludeItemTypes: input.includeItemTypes || 'Movie,Series,Episode,Video',
    Limit: String(input.limit || 80),
    GroupItems: String(input.groupItems ?? true),
  });
  if (input.parentId) params.set('ParentId', input.parentId);
  if (typeof input.isPlayed === 'boolean') params.set('IsPlayed', String(input.isPlayed));
  const items = await embyRequest<EmbyItem[]>(profile, `/Users/${profile.userId}/Items/Latest?${params.toString()}`);
  return { Items: items || [], TotalRecordCount: Array.isArray(items) ? items.length : 0, StartIndex: 0 } satisfies EmbyItemsResponse;
}

function fetchResume(profile: ServerProfile, input: { parentId?: string; limit?: number; includeItemTypes?: string }) {
  const params = new URLSearchParams({
    UserId: profile.userId,
    Recursive: 'true',
    IncludeItemTypes: input.includeItemTypes || 'Movie,Episode,Video',
    Fields: 'PrimaryImageAspectRatio,Overview,Genres,ProductionYear,RunTimeTicks,MediaSources,Path,DateCreated,PremiereDate,CommunityRating,SeriesInfo,ParentId,ParentIndexNumber,IndexNumber,UserData,RecursiveItemCount',
    Limit: String(input.limit || 80),
  });
  if (input.parentId) params.set('ParentId', input.parentId);
  return embyRequest<EmbyItemsResponse>(profile, `/Users/${profile.userId}/Items/Resume?${params.toString()}`);
}

function fetchNextUp(profile: ServerProfile, input: { parentId?: string; limit?: number }) {
  const params = new URLSearchParams({
    UserId: profile.userId,
    Fields: 'PrimaryImageAspectRatio,Overview,Genres,ProductionYear,RunTimeTicks,MediaSources,Path,DateCreated,PremiereDate,CommunityRating,SeriesInfo,ParentId,ParentIndexNumber,IndexNumber,UserData,RecursiveItemCount',
    Limit: String(input.limit || 80),
  });
  if (input.parentId) params.set('ParentId', input.parentId);
  return embyRequest<EmbyItemsResponse>(profile, `/Shows/NextUp?${params.toString()}`);
}

function fetchItem(profile: ServerProfile, itemId: string) {
  return embyRequest<EmbyItem>(profile, `/Users/${profile.userId}/Items/${itemId}`);
}

function fetchEpisodes(profile: ServerProfile, seriesId: string, sortOrder: SortOrder = 'Ascending') {
  const params = new URLSearchParams({
    UserId: profile.userId,
    Fields: 'Overview,RunTimeTicks,MediaSources,PrimaryImageAspectRatio,PremiereDate,DateCreated,UserData',
    SortBy: 'ParentIndexNumber,IndexNumber,SortName',
    SortOrder: sortOrder,
  });
  return embyRequest<EmbyItemsResponse>(profile, `/Shows/${seriesId}/Episodes?${params.toString()}`);
}

function fetchPlaybackInfo(profile: ServerProfile, itemId: string, mediaSourceId?: string) {
  return embyRequest<PlaybackInfoResponse>(profile, `/Items/${itemId}/PlaybackInfo`, {
    method: 'POST',
    body: JSON.stringify({
      UserId: profile.userId,
      MediaSourceId: mediaSourceId,
      EnableDirectPlay: true,
      EnableDirectStream: true,
      EnableTranscoding: true,
      StartTimeTicks: 0,
    }),
  });
}

function setFavorite(profile: ServerProfile, itemId: string, favorite: boolean) {
  return embyRequest(profile, `/Users/${profile.userId}/FavoriteItems/${itemId}`, { method: favorite ? 'POST' : 'DELETE' });
}

function setPlayed(profile: ServerProfile, itemId: string, played: boolean) {
  return embyRequest(profile, `/Users/${profile.userId}/PlayedItems/${itemId}`, { method: played ? 'POST' : 'DELETE' });
}

function compareEpisodes(a: EmbyItem, b: EmbyItem, order: SortOrder) {
  const seasonA = a.ParentIndexNumber ?? 0;
  const seasonB = b.ParentIndexNumber ?? 0;
  const episodeA = a.IndexNumber ?? 0;
  const episodeB = b.IndexNumber ?? 0;
  const result = seasonA - seasonB || episodeA - episodeB || a.Name.localeCompare(b.Name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
  return order === 'Ascending' ? result : -result;
}

function sortLocalItems(items: EmbyItem[], sortBy: SortOption, order: SortOrder) {
  const direction = order === 'Ascending' ? 1 : -1;
  return [...items].sort((a, b) => {
    if (sortBy === 'SortName') return direction * a.Name.localeCompare(b.Name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
    if (sortBy === 'CommunityRating') return direction * ((a.CommunityRating || 0) - (b.CommunityRating || 0));
    if (sortBy === 'RunTimeTicks') return direction * ((a.RunTimeTicks || 0) - (b.RunTimeTicks || 0));
    const av = Date.parse((sortBy === 'PremiereDate' ? a.PremiereDate : a.DateCreated) || '') || 0;
    const bv = Date.parse((sortBy === 'PremiereDate' ? b.PremiereDate : b.DateCreated) || '') || 0;
    return direction * (av - bv || a.Name.localeCompare(b.Name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }));
  });
}

function filterLocalItems(items: EmbyItem[], filter: FilterOption) {
  if (filter === 'unplayed') return items.filter((item) => !item.UserData?.Played || (item.UserData?.PlaybackPositionTicks || 0) > 0);
  if (filter === 'favorite') return items.filter((item) => item.UserData?.IsFavorite);
  return items;
}

function toSeriesCard(episode: EmbyItem): EmbyItem | null {
  const seriesId = episode.SeriesId || episode.ParentId;
  if (!seriesId || !episode.SeriesName) return null;
  return {
    Id: seriesId,
    Name: episode.SeriesName,
    Type: 'Series',
    ProductionYear: episode.ProductionYear,
    ImageTags: episode.SeriesPrimaryImageTag ? { Primary: episode.SeriesPrimaryImageTag } : episode.ImageTags,
    Overview: episode.Overview,
    ParentBackdropItemId: episode.ParentBackdropItemId,
    DateCreated: episode.DateCreated,
    PremiereDate: episode.PremiereDate,
  };
}

function buildResultGroups(items: EmbyItem[], search: string, mode: HomeMode): ResultGroup[] {
  const trimmed = search.trim();
  if (!trimmed && mode === 'resume') return [{ key: 'resume', title: '继续观看', description: '官方 Resume 列表：从上次进度继续播放', items }];
  if (!trimmed && mode === 'latest') return [{ key: 'latest', title: '最新入库', description: '官方 Latest Items：最近添加到服务器的内容', items }];
  if (!trimmed && mode === 'nextup') return [{ key: 'nextup', title: '下一集', description: '官方 Next Up：根据观看记录推荐下一集', items }];
  if (!trimmed) return [{ key: 'all', title: '全部结果', description: '当前媒体库内容', items }];

  const seriesMap = new Map<string, EmbyItem>();
  const movies: EmbyItem[] = [];
  const videos: EmbyItem[] = [];
  const episodes: EmbyItem[] = [];

  for (const item of items) {
    if (item.Type === 'Series') {
      seriesMap.set(item.Id, item);
      continue;
    }
    if (item.Type === 'Episode') {
      episodes.push(item);
      const series = toSeriesCard(item);
      if (series) {
        const existing = seriesMap.get(series.Id);
        seriesMap.set(series.Id, { ...(existing || series), matchedEpisodes: (existing?.matchedEpisodes || 0) + 1 });
      }
      continue;
    }
    if (item.Type === 'Movie') movies.push(item);
    else videos.push(item);
  }

  const series = Array.from(seriesMap.values()).sort((a, b) => (b.matchedEpisodes || 0) - (a.matchedEpisodes || 0));
  const groups: ResultGroup[] = [];
  if (series.length) groups.push({ key: 'series', title: '剧集优先', description: '命中单集会自动归并到剧集，点开直接选集', items: series });
  if (movies.length) groups.push({ key: 'movies', title: '电影', description: '匹配到的电影条目', items: movies });
  if (videos.length) groups.push({ key: 'videos', title: '视频', description: '其他视频文件', items: videos });
  if (!series.length && episodes.length) groups.push({ key: 'episodes', title: '单集', description: '未能识别所属剧集的单集结果', items: episodes });
  return groups;
}

function formatSubtitleLabel(stream: EmbyMediaStream) {
  const base = stream.DisplayTitle || stream.Title || stream.Language || '未命名字幕';
  const flags = [stream.IsForced ? '强制' : '', stream.Codec ? stream.Codec.toUpperCase() : ''].filter(Boolean);
  return flags.length ? `${base} · ${flags.join(' · ')}` : base;
}

function normalizeSubtitleTracks(profile: ServerProfile, itemId: string, mediaSource: PlaybackMediaSource) {
  const allStreams = mediaSource.MediaStreams || [];
  const textTracks = allStreams.filter((stream) => stream.Type === 'Subtitle' && stream.IsTextSubtitleStream);
  const unsupported = allStreams.filter((stream) => stream.Type === 'Subtitle' && !stream.IsTextSubtitleStream);
  const subtitles = textTracks.map((stream) => ({
    id: `${mediaSource.Id}-${stream.Index}`,
    label: formatSubtitleLabel(stream),
    language: stream.Language || 'und',
    src: getSubtitleUrl(profile, itemId, mediaSource.Id, stream.Index, 'vtt'),
    isDefault: stream.IsDefault || mediaSource.DefaultSubtitleStreamIndex === stream.Index,
    codec: stream.Codec,
    isForced: stream.IsForced,
  } satisfies PlayerSubtitle));
  return {
    subtitles,
    unsupportedLabels: unsupported.map((stream) => formatSubtitleLabel(stream)),
  };
}

function AutoConnectGate({ status, error, onRetry }: { status: LoadState; error: string; onRetry: () => void }) {
  return (
    <div className="login-shell auto-shell">
      <section className="login-hero compact-hero">
        <div className="orb orb-a" />
        <div className="orb orb-b" />
        <div className="brand-mark"><MonitorPlay size={34} /></div>
        <p className="eyebrow">Aurora Emby Web</p>
        <h1>正在连接默认媒体线路。</h1>
        <p className="hero-copy">默认服务器配置已内置，前端不再显示可编辑入口。连上后直接进媒体库和页面内播放器。</p>
        <div className="hero-metrics">
          <span>默认配置已隐藏</span>
          <span>网页内直连播放</span>
          <span>字幕菜单已接入</span>
        </div>
      </section>
      <section className="login-card auto-card">
        <div>
          <p className="eyebrow">自动连接</p>
          <h2>{status === 'loading' ? '正在连接 Emby' : status === 'error' ? '连接失败' : '准备进入媒体库'}</h2>
        </div>
        {status === 'loading' && <div className="connect-state"><Loader2 className="spin" size={22} /><span>正在使用默认线路登录，请稍等。</span></div>}
        {status === 'error' && <div className="error-box">{error}</div>}
        <p className="field-note">如果这里反复失败，通常是 Emby 本体、Cloudflare 反代或浏览器跨域限制在搞事。</p>
        {status === 'error' && <button className="primary-button" onClick={onRetry}><Wifi size={18} />重新连接默认线路</button>}
      </section>
    </div>
  );
}

function Sidebar({
  activeView,
  views,
  screen,
  onScreen,
  onSelectView,
}: {
  activeView?: string;
  views: EmbyItem[];
  screen: Screen;
  onScreen: (screen: Screen) => void;
  onSelectView: (id?: string) => void;
}) {
  return (
    <aside className="sidebar">
      <div className="side-brand">
        <div className="brand-mark small"><MonitorPlay size={22} /></div>
        <div><strong>Aurora</strong><span>Emby Web</span></div>
      </div>
      <button className={`nav-item ${screen === 'home' && !activeView ? 'active' : ''}`} onClick={() => { onScreen('home'); onSelectView(undefined); }}><Sparkles size={18} />全部媒体</button>
      {views.map((view) => (
        <button key={view.Id} className={`nav-item ${activeView === view.Id ? 'active' : ''}`} onClick={() => { onScreen('home'); onSelectView(view.Id); }}>
          {view.CollectionType === 'movies' ? <Film size={18} /> : <Library size={18} />}
          {view.Name}
        </button>
      ))}
      <div className="side-spacer" />
      <div className="server-hint">
        <span>默认线路已隐藏</span>
        <strong>直连播放</strong>
      </div>
      <button className={`nav-item ${screen === 'settings' ? 'active' : ''}`} onClick={() => onScreen('settings')}><Settings size={18} />设置</button>
    </aside>
  );
}

function Poster({ item, profile, onClick, density }: { item: EmbyItem; profile: ServerProfile; onClick: () => void; density: DensityOption }) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = useMemo(() => getImageUrl(profile, { itemId: item.Id, tag: item.ImageTags?.Primary, width: density === 'compact' ? 300 : 460 }), [profile, item.Id, item.ImageTags?.Primary, density]);
  const progress = item.UserData?.PlaybackPositionTicks && item.RunTimeTicks ? Math.min(100, Math.round((item.UserData.PlaybackPositionTicks / item.RunTimeTicks) * 100)) : 0;
  const subtitle = item.Type === 'Episode'
    ? `${item.SeriesName || '单集'} S${item.ParentIndexNumber || 1}E${item.IndexNumber || 0}`
    : item.Type === 'Series' && item.matchedEpisodes
      ? `命中 ${item.matchedEpisodes} 集`
      : item.ProductionYear || ticksToTime(item.RunTimeTicks);

  return (
    <button className="poster-card" onClick={onClick}>
      <div className="poster-art">
        {!imageFailed ? <img src={imageUrl} alt={item.Name} loading="lazy" onError={() => setImageFailed(true)} /> : <div className="poster-fallback"><Film size={36} /></div>}
        <span className="type-pill">{item.Type === 'Series' ? '剧集' : item.Type === 'Movie' ? '电影' : item.Type === 'Episode' ? '单集' : '视频'}</span>
        {item.UserData?.IsFavorite && <span className="favorite-pill"><Star size={12} />收藏</span>}
        {progress > 0 && <div className="progress-line"><span style={{ width: `${progress}%` }} /></div>}
      </div>
      <div className="poster-info"><strong title={item.Name}>{item.Name}</strong><span>{subtitle}</span></div>
    </button>
  );
}

function PlayerOverlay({
  profile,
  session,
  onClose,
}: {
  profile: ServerProfile;
  session?: PlayerSession;
  onClose: () => void;
}) {
  const playerRef = useRef<MediaPlayerElement | null>(null);

  useEffect(() => {
    if (!session || !playerRef.current) return;
    const player = playerRef.current as MediaPlayerElement & { textTracks: { clear: () => void; add: (track: TextTrack) => void } };
    player.textTracks.clear();
    session.subtitles.forEach((track) => {
      player.textTracks.add(new TextTrack({
        src: track.src,
        kind: 'subtitles',
        label: track.label,
        language: track.language,
        type: 'vtt',
        default: track.isDefault,
      }));
    });
  }, [session]);

  if (!session) return null;

  const subtitleMessage = session.subtitles.length > 0
    ? `已挂载 ${session.subtitles.length} 条文本字幕，播放器右下设置菜单里可直接切换。`
    : '当前没有可直接挂载的文本字幕。';

  return (
    <div className="player-backdrop" onMouseDown={onClose}>
      <section className="player-shell" onMouseDown={(event) => event.stopPropagation()}>
        <div className="player-head">
          <div>
            <p className="eyebrow">页面内播放器</p>
            <h2>{session.item.Name}</h2>
          </div>
          <button className="icon-button close" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="player-stage">
          <MediaPlayer
            ref={playerRef}
            key={session.sourceUrl}
            title={session.item.Name}
            src={session.sourceUrl}
            poster={session.posterUrl}
            streamType="on-demand"
            viewType="video"
            crossorigin
            playsInline
          >
            <MediaOutlet />
            <MediaCommunitySkin translations={playerTranslations} />
          </MediaPlayer>
        </div>
        <div className="player-panels">
          <div className="panel-card player-note">
            <h3>字幕状态</h3>
            <p className="muted">{subtitleMessage}</p>
            {session.subtitles.length > 0 && (
              <div className="subtitle-list">
                {session.subtitles.map((track) => (
                  <div className="subtitle-pill" key={track.id}>
                    <span>{track.label}</span>
                    {track.isDefault ? <strong>默认</strong> : null}
                  </div>
                ))}
              </div>
            )}
            {session.unsupportedSubtitleLabels.length > 0 && (
              <div className="warning-box compact-warning">
                <AlertTriangle size={16} />
                <span>以下字幕不是文本轨，浏览器通常不能直接挂载：{session.unsupportedSubtitleLabels.join('、')}。这种情况要靠 Emby 转码或烧录字幕。</span>
              </div>
            )}
          </div>
          <div className="panel-card player-note">
            <h3>播放说明</h3>
            <ul className="tutorial-list compact">
              <li>播放器右下角“设置”里可以切换字幕、清晰度、倍速。</li>
              <li>如果字幕菜单为空，说明当前片源没有可直接转换成浏览器文本轨的字幕。</li>
              <li>如果视频黑屏或无法播放，通常是该媒体编码浏览器不认，或者服务器需要更强的转码支持。</li>
            </ul>
            <div className="action-row compact-actions">
              <a className="secondary-button" href={session.sourceUrl} target="_blank" rel="noreferrer"><SquareArrowOutUpRight size={16} />新标签页打开流</a>
              <button className="chip-button" onClick={async () => navigator.clipboard.writeText(session.sourceUrl)}><Copy size={16} />复制直链</button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function DetailDrawer({
  profile,
  item,
  onClose,
  onChanged,
}: {
  profile: ServerProfile;
  item?: EmbyItem;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<EmbyItem | undefined>(item);
  const [episodes, setEpisodes] = useState<EmbyItem[]>([]);
  const [status, setStatus] = useState<LoadState>('idle');
  const [playStatus, setPlayStatus] = useState('');
  const [imageFailed, setImageFailed] = useState(false);
  const [episodeOrder, setEpisodeOrder] = useState<SortOrder>('Ascending');
  const [playerSession, setPlayerSession] = useState<PlayerSession | undefined>();
  const [playerLoading, setPlayerLoading] = useState(false);
  const sortedEpisodes = useMemo(() => [...episodes].sort((a, b) => compareEpisodes(a, b, episodeOrder)), [episodes, episodeOrder]);

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    setDetail(item);
    setEpisodes([]);
    setStatus('loading');
    setPlayStatus('');
    setImageFailed(false);
    setEpisodeOrder('Ascending');
    setPlayerSession(undefined);

    Promise.all([
      fetchItem(profile, item.Id),
      item.Type === 'Series' ? fetchEpisodes(profile, item.Id, 'Ascending') : Promise.resolve({ Items: [], TotalRecordCount: 0, StartIndex: 0 }),
    ]).then(([nextDetail, episodeResponse]) => {
      if (cancelled) return;
      setDetail(nextDetail);
      setEpisodes((episodeResponse.Items || []).sort((a, b) => compareEpisodes(a, b, 'Ascending')));
      setStatus('ready');
    }).catch((err) => {
      if (cancelled) return;
      setPlayStatus(getErrorMessage(err));
      setStatus('error');
    });

    return () => { cancelled = true; };
  }, [item, profile]);

  if (!item || !detail) return null;
  const playable = detail.Type !== 'Series';
  const imageUrl = getImageUrl(profile, { itemId: detail.Id, tag: detail.ImageTags?.Primary, width: 680 });

  async function copyLink(target: EmbyItem) {
    try {
      const url = getStreamUrl(profile, target.Id, target.MediaSources?.[0]?.Id);
      await navigator.clipboard.writeText(url);
      setPlayStatus('已复制播放直链。');
    } catch (err) {
      setPlayStatus(`复制失败：${getErrorMessage(err)}`);
    }
  }

  function openStream(target: EmbyItem) {
    const url = getStreamUrl(profile, target.Id, target.MediaSources?.[0]?.Id);
    window.open(url, '_blank', 'noopener,noreferrer');
    setPlayStatus('已用新标签页打开直链。');
  }

  async function openPlayer(target: EmbyItem) {
    try {
      setPlayerLoading(true);
      setPlayStatus('正在拉取播放信息和字幕轨...');
      const playback = await fetchPlaybackInfo(profile, target.Id, target.MediaSources?.[0]?.Id);
      const source = playback.MediaSources?.[0] || ({ Id: target.MediaSources?.[0]?.Id || '', ...target.MediaSources?.[0] } as PlaybackMediaSource);
      if (!source?.Id) throw new Error('没有拿到可播放的 MediaSourceId');
      const normalized = normalizeSubtitleTracks(profile, target.Id, source);
      setPlayerSession({
        item: target,
        sourceUrl: getStreamUrl(profile, target.Id, source.Id),
        posterUrl: getImageUrl(profile, { itemId: target.Id, tag: target.ImageTags?.Primary, width: 1280 }),
        mediaSource: source,
        subtitles: normalized.subtitles,
        unsupportedSubtitleLabels: normalized.unsupportedLabels,
      });
      setPlayStatus(normalized.subtitles.length > 0 ? '播放器已准备好，字幕菜单也一起接进去了。' : '播放器已准备好，但当前片源没有可直接挂载的文本字幕。');
    } catch (err) {
      setPlayStatus(getErrorMessage(err));
    } finally {
      setPlayerLoading(false);
    }
  }

  async function toggleFavorite() {
    if (!detail) return;
    try {
      const current = detail;
      const favorite = !current.UserData?.IsFavorite;
      await setFavorite(profile, current.Id, favorite);
      setDetail({ ...current, UserData: { ...current.UserData, IsFavorite: favorite } });
      setPlayStatus(favorite ? '已加入收藏。' : '已取消收藏。');
      onChanged();
    } catch (err) {
      setPlayStatus(getErrorMessage(err));
    }
  }

  async function togglePlayed() {
    if (!detail) return;
    try {
      const current = detail;
      const played = !current.UserData?.Played;
      await setPlayed(profile, current.Id, played);
      setDetail({ ...current, UserData: { ...current.UserData, Played: played, PlaybackPositionTicks: played ? 0 : current.UserData?.PlaybackPositionTicks } });
      setPlayStatus(played ? '已标记为已看。' : '已标记为未看。');
      onChanged();
    } catch (err) {
      setPlayStatus(getErrorMessage(err));
    }
  }

  return (
    <>
      <div className="drawer-backdrop" onMouseDown={onClose}>
        <aside className="detail-drawer" onMouseDown={(event) => event.stopPropagation()}>
          <button className="icon-button close" onClick={onClose}><X size={20} /></button>
          <div className="detail-top">
            <div className="detail-poster">
              {!imageFailed ? <img src={imageUrl} alt={detail.Name} onError={() => setImageFailed(true)} /> : <Film size={48} />}
            </div>
            <div className="detail-copy">
              <span className="type-pill inline">{detail.Type}</span>
              <h2>{detail.Name}</h2>
              <p>{detail.Overview || '暂无简介。'}</p>
              <div className="meta-row">
                <span>{detail.ProductionYear || '未知年份'}</span>
                <span>{ticksToTime(detail.RunTimeTicks)}</span>
                {detail.CommunityRating ? <span>{detail.CommunityRating.toFixed(1)} 分</span> : null}
                {detail.UserData?.Played ? <span>已看完</span> : null}
              </div>
              <div className="action-row secondary-actions">
                <button className="chip-button" onClick={toggleFavorite}><Star size={16} />{detail.UserData?.IsFavorite ? '取消收藏' : '收藏'}</button>
                <button className="chip-button" onClick={togglePlayed}><Check size={16} />{detail.UserData?.Played ? '标为未看' : '标为已看'}</button>
              </div>
              {playable && (
                <div className="action-grid">
                  <button className="primary-button wide" onClick={() => openPlayer(detail)} disabled={playerLoading}>
                    {playerLoading ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
                    进入页面内播放器
                  </button>
                  <button className="secondary-button" onClick={() => copyLink(detail)}><Copy size={18} />复制直链</button>
                  <button className="secondary-button" onClick={() => openStream(detail)}><SquareArrowOutUpRight size={18} />浏览器打开</button>
                </div>
              )}
              {playStatus && <div className="hint-box">{playStatus}</div>}
            </div>
          </div>
          {detail.MediaSources?.length ? (
            <div className="source-panel">
              <h3>媒体源</h3>
              {detail.MediaSources.map((source) => (
                <div className="source-row" key={source.Id}>
                  <span>{source.Name || source.Container || '默认源'}</span>
                  <small>{bitrateToText(source.Bitrate)} · {bytesToSize(source.Size)} · {source.Protocol || 'File'}</small>
                </div>
              ))}
            </div>
          ) : null}
          {detail.Type === 'Series' && (
            <div className="episode-panel">
              <div className="episode-heading">
                <h3>剧集列表 {status === 'loading' && <Loader2 className="spin" size={16} />}</h3>
                <button className="chip-button" onClick={() => setEpisodeOrder((current) => current === 'Ascending' ? 'Descending' : 'Ascending')}>
                  {episodeOrder === 'Ascending' ? <ArrowDownAZ size={16} /> : <ArrowUpAZ size={16} />}
                  {episodeOrder === 'Ascending' ? '正序' : '倒序'}
                </button>
              </div>
              {sortedEpisodes.map((episode) => (
                <div className="episode-card" key={episode.Id}>
                  <button className="episode-row" onClick={() => openPlayer(episode)}>
                    <span>S{episode.ParentIndexNumber || 1}E{episode.IndexNumber || 0}</span>
                    <strong>{episode.Name}</strong>
                    <small>{ticksToTime(episode.RunTimeTicks)}</small>
                    <Play size={16} />
                  </button>
                  <div className="episode-actions">
                    <button className="mini-button" onClick={() => copyLink(episode)}><Copy size={14} />直链</button>
                    <button className="mini-button" onClick={() => openStream(episode)}><SquareArrowOutUpRight size={14} />打开</button>
                  </div>
                </div>
              ))}
              {status === 'ready' && episodes.length === 0 && <div className="empty-line">没有读取到剧集。</div>}
            </div>
          )}
        </aside>
      </div>
      <PlayerOverlay profile={profile} session={playerSession} onClose={() => setPlayerSession(undefined)} />
    </>
  );
}

function Home({ activeView, state, profile }: { activeView?: string; state: AppState; profile: ServerProfile }) {
  const [mode, setMode] = useState<HomeMode>('library');
  const [items, setItems] = useState<EmbyItem[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<LoadState>('idle');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<EmbyItem | undefined>();
  const [sortBy, setSortBy] = useState<SortOption>('DateCreated');
  const [sortOrder, setSortOrder] = useState<SortOrder>('Descending');
  const [filter, setFilter] = useState<FilterOption>('all');
  const [density, setDensity] = useState<DensityOption>('comfortable');
  const [limit, setLimit] = useState(100);
  const [refreshSeed, setRefreshSeed] = useState(0);

  const activeFilter = filterOptions.find((item) => item.value === filter) || filterOptions[0];
  const activeSort = sortOptions.find((item) => item.value === sortBy) || sortOptions[0];
  const visibleItems = useMemo(() => sortLocalItems(filterLocalItems(items, filter), sortBy, sortOrder), [items, filter, sortBy, sortOrder]);
  const groups = useMemo(() => buildResultGroups(visibleItems, search, mode), [visibleItems, search, mode]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setStatus('loading');
      setError('');
      const common = { parentId: activeView, limit: search.trim() ? Math.max(limit, 180) : limit, includeItemTypes: activeFilter.include };
      const request = mode === 'latest'
        ? fetchLatest(profile, { ...common, isPlayed: filter === 'unplayed' ? false : undefined, groupItems: true })
        : mode === 'resume'
          ? fetchResume(profile, common)
          : mode === 'nextup'
            ? fetchNextUp(profile, { parentId: activeView, limit })
            : fetchItems(profile, { ...common, searchTerm: search, sortBy: activeSort.emby, sortOrder, isPlayed: filter === 'unplayed' ? false : undefined });

      request.then((response) => {
        setItems(response.Items || []);
        setTotal(response.TotalRecordCount || response.Items?.length || 0);
        setStatus('ready');
      }).catch((err) => {
        setError(getErrorMessage(err));
        setStatus('error');
      });
    }, 240);

    return () => window.clearTimeout(timer);
  }, [activeView, search, limit, sortBy, sortOrder, filter, refreshSeed, mode, profile, activeFilter.include, activeSort.emby]);

  function switchMode(nextMode: HomeMode) {
    setMode(nextMode);
    setLimit(100);
    setSearch('');
  }

  return (
    <main className="content">
      <header className="topbar">
        <div>
          <p className="eyebrow">媒体库</p>
          <h1>{search.trim() ? '整合搜索' : homeModes.find((item) => item.value === mode)?.label || '影片与剧集'}</h1>
        </div>
        <div className="search-box">
          <Search size={18} />
          <input value={search} onChange={(event) => { setSearch(event.target.value); setLimit(100); }} placeholder="搜索电影、剧集、视频..." />
        </div>
      </header>
      <section className="mode-panel">
        {homeModes.map((item) => (
          <button key={item.value} className={`mode-card ${mode === item.value ? 'active' : ''}`} onClick={() => switchMode(item.value)}>
            <strong>{item.label}</strong>
            <span>{item.description}</span>
          </button>
        ))}
      </section>
      <section className="status-strip">
        <div><strong>{visibleItems.length}/{total}</strong><span>当前显示 / 总媒体</span></div>
        <div><strong>{mode === 'library' ? activeSort.label : homeModes.find((item) => item.value === mode)?.label}</strong><span>{mode === 'library' ? (sortOrder === 'Descending' ? '倒序' : '正序') : '官方接口'}</span></div>
        <div><strong>直连播放</strong><span>Vidstack 页面内播放器 + 字幕菜单</span></div>
      </section>
      <section className="toolbar-panel">
        <div className="control-group">
          <label>
            <span>排序</span>
            <select value={sortBy} disabled={mode !== 'library'} onChange={(event) => setSortBy(event.target.value as SortOption)}>
              {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button className="chip-button tall" disabled={mode !== 'library'} onClick={() => setSortOrder((current) => current === 'Descending' ? 'Ascending' : 'Descending')}>
            {sortOrder === 'Descending' ? <ArrowDownAZ size={17} /> : <ArrowUpAZ size={17} />}
            {sortOrder === 'Descending' ? '倒序' : '正序'}
          </button>
          <label>
            <span>筛选</span>
            <select value={filter} onChange={(event) => setFilter(event.target.value as FilterOption)}>
              {filterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          </label>
        </div>
        <div className="control-actions">
          <button className="chip-button" onClick={() => setRefreshSeed((value) => value + 1)}><RefreshCw size={16} />刷新</button>
          <button className="chip-button" onClick={() => setDensity((value) => value === 'comfortable' ? 'compact' : 'comfortable')}>
            {density === 'comfortable' ? <Grid3X3 size={16} /> : <Grid2X2 size={16} />}
            {density === 'comfortable' ? '紧凑' : '舒适'}
          </button>
        </div>
      </section>
      <div className="success-box"><Check size={18} /><span>播放器已改为页面内直连播放。点开详情后直接进 Vidstack，字幕切换在播放器设置菜单里。</span></div>
      {status === 'loading' && <div className={`grid ${density === 'compact' ? 'grid-compact' : ''} skeleton-grid`}>{Array.from({ length: 12 }).map((_, index) => <div className="skeleton-card" key={index} />)}</div>}
      {status === 'error' && <div className="error-state"><h3>加载失败</h3><p>{error}</p></div>}
      {status === 'ready' && visibleItems.length === 0 && <div className="empty-state"><Tv size={42} /><h3>没有找到媒体</h3><p>换个入口或关键词试试，比如继续观看、最新入库、下一集。</p></div>}
      {status === 'ready' && visibleItems.length > 0 && (
        <div className="group-stack">
          {groups.map((group) => (
            <section className="result-section" key={group.key}>
              <div className="section-heading"><div><h2>{group.title}</h2><p>{group.description}</p></div><span>{group.items.length}</span></div>
              <div className={`grid ${density === 'compact' ? 'grid-compact' : ''}`}>
                {group.items.map((entry) => <Poster key={`${group.key}-${entry.Id}`} item={entry} profile={profile} density={density} onClick={() => setSelected(entry)} />)}
              </div>
            </section>
          ))}
          {visibleItems.length < total && mode !== 'nextup' && <button className="load-more" onClick={() => setLimit((value) => value + 100)}><RefreshCw size={18} />加载更多</button>}
        </div>
      )}
      <DetailDrawer profile={profile} item={selected} onClose={() => setSelected(undefined)} onChanged={() => setRefreshSeed((value) => value + 1)} />
    </main>
  );
}

function SettingsPage({ profile, onReconnect }: { profile?: ServerProfile; onReconnect: () => void }) {
  const [message, setMessage] = useState('');

  function clearLocalSession() {
    window.localStorage.removeItem(STORAGE_KEY);
    setMessage('本地缓存已清空。重新连接后会自动写回新的登录态。');
  }

  return (
    <main className="content settings-content">
      <header className="topbar"><div><p className="eyebrow">播放器设置</p><h1>默认线路与字幕策略</h1></div></header>
      <section className="settings-grid">
        <section className="panel-card">
          <h2>默认线路</h2>
          <p className="muted">默认 Emby 地址、用户名、密码已经内置，但前端 UI 不再展示这些配置项。这里仅保留连接状态，不暴露服务器具体信息。</p>
          <div className="server-row masked-row">
            <div>
              <strong>{profile?.name || '默认 Emby 线路'}</strong>
              <span>{profile ? `最近登录：${new Date(profile.lastLoginAt).toLocaleString()}` : '尚未建立连接'}</span>
            </div>
            <button className="secondary-button" onClick={onReconnect}><Wifi size={16} />重新连接</button>
          </div>
        </section>

        <section className="panel-card">
          <h2>字幕说明</h2>
          <ul className="tutorial-list compact">
            <li>播放器已经接入字幕菜单，文本字幕会自动转换成 VTT 轨道加载。</li>
            <li>如果 Emby 返回的是 PGS、图形字幕或某些复杂内封 ASS，浏览器通常无法直接作为文本轨展示。</li>
            <li>这类字幕需要服务端转码、转字幕格式，或者直接烧录到视频流里。</li>
          </ul>
        </section>
      </section>

      <section className="tutorial-grid">
        <section className="panel-card">
          <h2>当前版本怎么用</h2>
          <ol className="tutorial-list">
            <li>页面会自动连默认线路，不再显示登录表单。</li>
            <li>进入影片详情后点“进入页面内播放器”。</li>
            <li>播放界面右下角打开“设置”，可切换字幕、倍速、清晰度。</li>
            <li>若字幕菜单为空，优先检查片源是否存在文本字幕轨。</li>
          </ol>
        </section>

        <section className="panel-card">
          <h2>维护操作</h2>
          <div className="action-row compact-actions">
            <button className="chip-button" onClick={clearLocalSession}><RefreshCw size={16} />清空本地缓存</button>
            <button className="chip-button" onClick={() => setMessage('如需真正隐藏服务器地址与账号，只能改成后端中转，纯静态前端做不到完全保密。')}><AlertTriangle size={16} />查看安全提醒</button>
          </div>
          {message && <div className="hint-box">{message}</div>}
        </section>
      </section>
    </main>
  );
}

export function App() {
  const [state, setState] = useState<AppState>(initialState);
  const [booting, setBooting] = useState(true);
  const [views, setViews] = useState<EmbyItem[]>([]);
  const [activeView, setActiveView] = useState<string | undefined>();
  const [screen, setScreen] = useState<Screen>('home');
  const [viewError, setViewError] = useState('');
  const [autoConnectStatus, setAutoConnectStatus] = useState<LoadState>('idle');
  const [autoConnectError, setAutoConnectError] = useState('');

  useTheme(state.theme);
  const hasProfile = state.profiles.length > 0;
  const activeProfile = useMemo(() => getActiveProfile(state), [state]);

  function patchState(next: Partial<AppState>) {
    setState((current) => ({ ...current, ...next }));
  }

  useEffect(() => {
    const next = readStoredState();
    setState(next);
    setBooting(false);
  }, []);

  useEffect(() => {
    if (booting) return;
    writeStoredState(state);
  }, [state, booting]);

  async function connectDefaultProfile() {
    try {
      setAutoConnectStatus('loading');
      setAutoConnectError('');
      const profile = await loginToEmby(defaultLogin);
      setState((current) => ({
        ...current,
        profiles: [profile],
        activeProfileId: profile.id,
      }));
      setAutoConnectStatus('ready');
    } catch (err) {
      setAutoConnectStatus('error');
      setAutoConnectError(getErrorMessage(err));
    }
  }

  useEffect(() => {
    if (booting || hasProfile || autoConnectStatus === 'loading') return;
    void connectDefaultProfile();
  }, [booting, hasProfile, autoConnectStatus]);

  useEffect(() => {
    if (!hasProfile || !activeProfile) return;
    fetchViews(activeProfile).then((response) => {
      setViews(response.Items || []);
      setViewError('');
    }).catch((err) => {
      setViews([]);
      setViewError(getErrorMessage(err));
    });
  }, [hasProfile, activeProfile]);

  if (booting) return <div className="boot-screen"><Loader2 className="spin" size={28} />正在启动网页播放器...</div>;
  if (!hasProfile || !activeProfile) return <AutoConnectGate status={autoConnectStatus} error={autoConnectError} onRetry={() => void connectDefaultProfile()} />;

  return (
    <div className="app-shell">
      <Sidebar views={views} activeView={activeView} screen={screen} onScreen={setScreen} onSelectView={setActiveView} />
      <div className="title-safe-zone" />
      <div className="theme-toggle" role="group" aria-label="主题切换">
        {(['light', 'dark', 'system'] as const).map((theme) => (
          <button key={theme} className={state.theme === theme ? 'active' : ''} onClick={() => patchState({ theme })}>
            {theme === 'light' ? '浅色' : theme === 'dark' ? '深色' : '系统'}
          </button>
        ))}
      </div>
      <div className="mobile-warning">{viewError && <div className="warning-box inline-warning"><AlertTriangle size={16} /><span>{viewError}</span></div>}</div>
      {screen === 'home'
        ? <Home activeView={activeView} state={state} profile={activeProfile} />
        : <SettingsPage profile={activeProfile} onReconnect={() => void connectDefaultProfile()} />}
    </div>
  );
}
