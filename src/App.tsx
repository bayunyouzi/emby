import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownAZ,
  ArrowUpAZ,
  CalendarClock,
  Check,
  Copy,
  Download,
  ExternalLink,
  Film,
  Grid2X2,
  Grid3X3,
  Library,
  Loader2,
  MonitorPlay,
  Play,
  RefreshCw,
  Search,
  Server,
  Settings,
  Sparkles,
  SquareArrowOutUpRight,
  Star,
  Trash2,
  Tv,
  Wifi,
  X,
} from 'lucide-react';
import type { AppState, EmbyItem, EmbyItemsResponse, LoginInput, ServerProfile, ThemeMode, ViewResponse } from './lib/types';
import { bitrateToText, bytesToSize, getErrorMessage, ticksToTime } from './lib/format';

type Screen = 'home' | 'settings';
type LoadState = 'idle' | 'loading' | 'error' | 'ready';
type SortOrder = 'Ascending' | 'Descending';
type SortOption = 'DateCreated' | 'PremiereDate' | 'SortName' | 'CommunityRating' | 'RunTimeTicks';
type FilterOption = 'all' | 'Series' | 'Movie' | 'Video' | 'unplayed' | 'favorite';
type DensityOption = 'comfortable' | 'compact';
type HomeMode = 'library' | 'latest' | 'resume' | 'nextup';
type ResultGroup = { key: string; title: string; description: string; items: EmbyItem[] };

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
  mpvPath: '',
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
      mpvPath: parsed.mpvPath || '',
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
      'X-Emby-Authorization': 'MediaBrowser Client="Aurora Emby Web", Device="Browser", DeviceId="aurora-emby-web", Version="1.0.0"',
    },
    body: JSON.stringify({ Username: username, Pw: password }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`登录失败：${response.status} ${response.statusText}${text ? ` - ${text.slice(0, 160)}` : ''}`);
  }

  const data = await response.json() as { AccessToken?: string; User?: { Id?: string; Name?: string } };
  if (!data.AccessToken || !data.User?.Id) throw new Error('登录响应缺少 AccessToken 或 UserId');

  const profile: ServerProfile = {
    id: `${serverUrl}|${data.User.Id}`,
    name: input.name.trim() || data.User.Name || username,
    url: serverUrl,
    username,
    accessToken: data.AccessToken,
    userId: data.User.Id,
    lastLoginAt: new Date().toISOString(),
  };

  return profile;
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

function escapePowerShell(text: string) {
  return text.replace(/`/g, '``').replace(/"/g, '`"');
}

function buildMpvCommand(profile: ServerProfile, item: EmbyItem, mpvPath: string) {
  const streamUrl = getStreamUrl(profile, item.Id, item.MediaSources?.[0]?.Id);
  const title = escapePowerShell(item.Name || 'Aurora Emby Web');
  const header = escapePowerShell(`X-Emby-Token: ${profile.accessToken}`);
  const executable = escapePowerShell(mpvPath.trim());
  const url = escapePowerShell(streamUrl);
  return `& "${executable}" --force-window=yes --profile=high-quality --hwdec=auto-safe --gpu-api=auto --vo=gpu-next --video-sync=display-resample --interpolation=yes --cache=yes --demuxer-max-bytes=512MiB --demuxer-max-back-bytes=256MiB --cache-secs=60 --network-timeout=15 --force-seekable=yes --save-position-on-quit=yes --title="${title}" --http-header-fields="${header}" "${url}"`;
}

function LoginPanel({ onLoggedIn }: { onLoggedIn: (profile: ServerProfile) => Promise<void> | void }) {
  const [form, setForm] = useState(defaultLogin);
  const [status, setStatus] = useState<LoadState>('idle');
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus('loading');
    setError('');
    try {
      const profile = await loginToEmby(form);
      await onLoggedIn(profile);
      setStatus('ready');
    } catch (err) {
      setError(getErrorMessage(err));
      setStatus('error');
    }
  }

  return (
    <div className="login-shell">
      <section className="login-hero">
        <div className="orb orb-a" />
        <div className="orb orb-b" />
        <div className="brand-mark"><MonitorPlay size={34} /></div>
        <p className="eyebrow">Aurora Emby Web</p>
        <h1>可直接部署到 Zeabur 的 Emby 网页版媒体库。</h1>
        <p className="hero-copy">不走本地代理，直接连接 Emby 官方接口。继续观看、最新入库、下一集、收藏、已看状态、搜索排序这些常用能力都给你留着。</p>
        <div className="hero-metrics">
          <span>直连 Emby</span>
          <span>公共账号默认填好</span>
          <span>mpv 命令一键复制</span>
        </div>
      </section>
      <form className="login-card" onSubmit={submit}>
        <div>
          <p className="eyebrow">连接服务器</p>
          <h2>登录 Emby</h2>
        </div>
        <label><span>服务器地址</span><input value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://example.com:443" /></label>
        <label><span>显示名称</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="我的 Emby" /></label>
        <label><span>用户名</span><input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} autoComplete="username" /></label>
        <label><span>密码</span><input value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} type="password" autoComplete="current-password" /></label>
        <p className="field-note">默认公共账号已经填好。若登录成功但后续列表加载失败，通常是 Emby 或反代没放行浏览器跨域。</p>
        {error && <div className="error-box">{error}</div>}
        <button className="primary-button" disabled={status === 'loading'}>
          {status === 'loading' ? <Loader2 className="spin" size={18} /> : <Wifi size={18} />}
          连接并进入媒体库
        </button>
      </form>
    </div>
  );
}

function Sidebar({
  state,
  activeView,
  views,
  screen,
  onScreen,
  onSelectView,
  onProfileChange,
}: {
  state: AppState;
  activeView?: string;
  views: EmbyItem[];
  screen: Screen;
  onScreen: (screen: Screen) => void;
  onSelectView: (id?: string) => void;
  onProfileChange: (profileId: string) => void;
}) {
  const activeProfile = getActiveProfile(state);
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
      <div className="profile-switcher">
        <span>当前服务器</span>
        <select value={activeProfile?.id || ''} onChange={(event) => onProfileChange(event.target.value)}>
          {state.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
        </select>
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

function DetailDrawer({
  profile,
  item,
  mpvPath,
  onClose,
  onChanged,
}: {
  profile: ServerProfile;
  item?: EmbyItem;
  mpvPath: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<EmbyItem | undefined>(item);
  const [episodes, setEpisodes] = useState<EmbyItem[]>([]);
  const [status, setStatus] = useState<LoadState>('idle');
  const [playStatus, setPlayStatus] = useState('');
  const [commandPreview, setCommandPreview] = useState('');
  const [imageFailed, setImageFailed] = useState(false);
  const [episodeOrder, setEpisodeOrder] = useState<SortOrder>('Ascending');
  const sortedEpisodes = useMemo(() => [...episodes].sort((a, b) => compareEpisodes(a, b, episodeOrder)), [episodes, episodeOrder]);

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    setDetail(item);
    setEpisodes([]);
    setStatus('loading');
    setPlayStatus('');
    setCommandPreview('');
    setImageFailed(false);
    setEpisodeOrder('Ascending');

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
      setCommandPreview(url);
    } catch (err) {
      setPlayStatus(`复制失败：${getErrorMessage(err)}`);
    }
  }

  function openStream(target: EmbyItem) {
    const url = getStreamUrl(profile, target.Id, target.MediaSources?.[0]?.Id);
    window.open(url, '_blank', 'noopener,noreferrer');
    setPlayStatus('已用新标签页打开直链。');
    setCommandPreview(url);
  }

  async function playWithMpv(target: EmbyItem) {
    const path = mpvPath.trim();
    if (!path) {
      setPlayStatus('还没有填写 mpv.exe 路径。先去设置页保存路径，再回来点播放即可复制完整命令。');
      setCommandPreview('');
      return;
    }
    try {
      const command = buildMpvCommand(profile, target, path);
      await navigator.clipboard.writeText(command);
      setCommandPreview(command);
      setPlayStatus('已复制 PowerShell 播放命令。把命令粘贴到本机 PowerShell 回车即可用 mpv 播放。');
    } catch (err) {
      setPlayStatus(getErrorMessage(err));
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
                <button className="primary-button wide" onClick={() => playWithMpv(detail)}><Play size={18} />复制 mpv 播放命令</button>
                <button className="secondary-button" onClick={() => copyLink(detail)}><Copy size={18} />复制直链</button>
                <button className="secondary-button" onClick={() => openStream(detail)}><SquareArrowOutUpRight size={18} />浏览器打开</button>
              </div>
            )}
            {playStatus && <div className="hint-box">{playStatus}</div>}
            {commandPreview && <pre className="command-box">{commandPreview}</pre>}
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
                <button className="episode-row" onClick={() => playWithMpv(episode)}>
                  <span>S{episode.ParentIndexNumber || 1}E{episode.IndexNumber || 0}</span>
                  <strong>{episode.Name}</strong>
                  <small>{ticksToTime(episode.RunTimeTicks)}</small>
                  <Play size={16} />
                </button>
                <div className="episode-actions">
                  <button className="mini-button" onClick={() => copyLink(episode)}><Copy size={14} />直链</button>
                  <button className="mini-button" onClick={() => openStream(episode)}><ExternalLink size={14} />打开</button>
                </div>
              </div>
            ))}
            {status === 'ready' && episodes.length === 0 && <div className="empty-line">没有读取到剧集。</div>}
          </div>
        )}
      </aside>
    </div>
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
        <div><strong>{state.mpvPath.trim() ? 'Ready' : '待填写'}</strong><span>{state.mpvPath.trim() ? '已保存 mpv.exe 路径' : '去设置页填写 mpv.exe 路径'}</span></div>
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
              {filterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
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
      {!state.mpvPath.trim() && <div className="warning-box"><AlertTriangle size={18} /><span>网页不能直接启动本地 exe。先到设置页填好 mpv.exe 路径，之后点“复制 mpv 播放命令”即可本机播放。</span></div>}
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
          {visibleItems.length < total && mode !== 'nextup' && <button className="load-more" onClick={() => setLimit((value) => value + 100)}><CalendarClock size={18} />加载更多</button>}
        </div>
      )}
      <DetailDrawer profile={profile} item={selected} mpvPath={state.mpvPath} onClose={() => setSelected(undefined)} onChanged={() => setRefreshSeed((value) => value + 1)} />
    </main>
  );
}

function SettingsPage({ state, onState }: { state: AppState; onState: (patch: Partial<AppState>) => void }) {
  const [login, setLogin] = useState(defaultLogin);
  const [mpvPath, setMpvPath] = useState(state.mpvPath || '');
  const [message, setMessage] = useState('');
  const [sampleCommand, setSampleCommand] = useState('');
  const activeProfile = getActiveProfile(state);

  useEffect(() => setMpvPath(state.mpvPath || ''), [state.mpvPath]);

  useEffect(() => {
    if (!activeProfile || !mpvPath.trim()) {
      setSampleCommand('');
      return;
    }
    const demoItem: EmbyItem = { Id: 'demo', Name: '示例视频', Type: 'Video', MediaSources: [{ Id: 'default' }] };
    const streamUrl = `${activeProfile.url}/Videos/示例ID/stream?static=true&api_key=${activeProfile.accessToken}`;
    const command = buildMpvCommand(activeProfile, { ...demoItem, Id: '示例ID' }, mpvPath).replace(/示例ID/g, '真实媒体ID').replace(getStreamUrl(activeProfile, '真实媒体ID', 'default'), streamUrl);
    setSampleCommand(command);
  }, [activeProfile, mpvPath]);

  async function addServer(event: React.FormEvent) {
    event.preventDefault();
    try {
      const profile = await loginToEmby(login);
      const profiles = [profile, ...state.profiles.filter((item) => item.id !== profile.id)];
      onState({ profiles, activeProfileId: profile.id });
      setMessage('服务器已添加并切换。');
    } catch (err) {
      setMessage(getErrorMessage(err));
    }
  }

  function remove(profile: ServerProfile) {
    const profiles = state.profiles.filter((item) => item.id !== profile.id);
    onState({ profiles, activeProfileId: profiles[0]?.id });
    setMessage('服务器已移除。');
  }

  function saveMpvPath() {
    onState({ mpvPath: mpvPath.trim() });
    setMessage(mpvPath.trim() ? 'mpv 路径已保存。之后在详情里点“复制 mpv 播放命令”即可。' : '已清空 mpv 路径。');
  }

  async function copySample() {
    if (!sampleCommand) return;
    await navigator.clipboard.writeText(sampleCommand);
    setMessage('已复制示例命令。');
  }

  return (
    <main className="content settings-content">
      <header className="topbar"><div><p className="eyebrow">播放器设置</p><h1>服务器与 mpv</h1></div></header>
      <section className="settings-grid">
        <form className="panel-card" onSubmit={addServer}>
          <h2>添加 Emby 服务器</h2>
          <label><span>服务器地址</span><input value={login.url} onChange={(event) => setLogin({ ...login, url: event.target.value })} /></label>
          <label><span>名称</span><input value={login.name} onChange={(event) => setLogin({ ...login, name: event.target.value })} /></label>
          <label><span>用户名</span><input value={login.username} onChange={(event) => setLogin({ ...login, username: event.target.value })} /></label>
          <label><span>密码</span><input value={login.password} type="password" onChange={(event) => setLogin({ ...login, password: event.target.value })} /></label>
          <button className="primary-button"><Server size={18} />保存服务器</button>
          <p className="field-note">这是纯网页版本，不走桌面代理。能否正常浏览内容，取决于 Emby 服务器是否允许浏览器直接跨域访问。</p>
        </form>

        <section className="panel-card">
          <h2>mpv 本机播放</h2>
          <p className="muted">浏览器不能直接替你启动本地 exe，这是浏览器安全限制，不是我偷懒。这里改成更稳的方案：你填一次 mpv.exe 路径，之后点播放就自动复制完整 PowerShell 命令。</p>
          <label><span>mpv.exe 路径</span><input value={mpvPath} onChange={(event) => setMpvPath(event.target.value)} placeholder="C:\\Tools\\mpv\\mpv.exe" /></label>
          <div className="action-row compact-actions">
            <button className="secondary-button" type="button" onClick={saveMpvPath}>保存路径</button>
            <a className="download-link" href="/downloads/mpv-x86_64-20260610-git-304426c.7z" download><Download size={16} />下载 mpv 压缩包</a>
          </div>
          {sampleCommand && <pre className="command-box small">{sampleCommand}</pre>}
          {sampleCommand && <button className="chip-button" type="button" onClick={copySample}><Copy size={16} />复制示例命令</button>}
        </section>
      </section>

      <section className="tutorial-grid">
        <section className="panel-card">
          <h2>使用教程</h2>
          <ol className="tutorial-list">
            <li>下载右侧提供的 mpv 压缩包，解压到任意目录，比如 <code>C:\\Tools\\mpv</code>。</li>
            <li>把 <code>mpv.exe</code> 的完整路径填到上面的输入框，例如 <code>C:\\Tools\\mpv\\mpv.exe</code>。</li>
            <li>回到媒体库，点任意影片详情里的“复制 mpv 播放命令”。</li>
            <li>在你的 Windows PowerShell 粘贴并回车，mpv 就会直接播放该视频。</li>
            <li>如果你只想拿播放地址，不想用 mpv，也可以点“复制直链”或“浏览器打开”。</li>
          </ol>
        </section>

        <section className="panel-card">
          <h2>已保存服务器</h2>
          {state.profiles.length === 0 && <div className="empty-line">还没有保存服务器。</div>}
          {state.profiles.map((profile) => (
            <div className="server-row" key={profile.id}>
              <div>
                <strong>{profile.name}</strong>
                <span>{profile.url} · {profile.username}</span>
              </div>
              <button className="danger-button" onClick={() => remove(profile)}><Trash2 size={16} />移除</button>
            </div>
          ))}
        </section>
      </section>

      <section className="panel-card note-panel">
        <h2>部署提醒</h2>
        <ul className="tutorial-list compact">
          <li>Zeabur 直接导入这个项目即可，构建命令用 <code>npm run build</code>，输出目录是 <code>dist</code>。</li>
          <li>启动命令可以用 <code>npm run start</code>。这个版本本质上是静态前端，用 preview 服务承载即可。</li>
          <li>如果登录成功、但海报或媒体列表加载失败，优先检查 Emby 或 Cloudflare 反代的 CORS 配置。</li>
        </ul>
      </section>

      {message && <div className="floating-message hint-box">{message}</div>}
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

  async function handleLoggedIn(profile: ServerProfile) {
    const profiles = [profile, ...state.profiles.filter((item) => item.id !== profile.id)];
    setState((current) => ({ ...current, profiles, activeProfileId: profile.id }));
  }

  function handleProfileChange(profileId: string) {
    patchState({ activeProfileId: profileId });
    setActiveView(undefined);
    setScreen('home');
  }

  if (booting) return <div className="boot-screen"><Loader2 className="spin" size={28} />正在启动网页播放器...</div>;
  if (!hasProfile) return <LoginPanel onLoggedIn={handleLoggedIn} />;
  if (!activeProfile) return <LoginPanel onLoggedIn={handleLoggedIn} />;

  return (
    <div className="app-shell">
      <Sidebar state={state} views={views} activeView={activeView} screen={screen} onScreen={setScreen} onSelectView={setActiveView} onProfileChange={handleProfileChange} />
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
        : <SettingsPage state={state} onState={patchState} />}
    </div>
  );
}
