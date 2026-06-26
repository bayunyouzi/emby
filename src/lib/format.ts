export function ticksToTime(ticks?: number) {
  if (!ticks) return '未知时长';
  const seconds = Math.floor(ticks / 10_000_000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}小时${minutes ? ` ${minutes}分钟` : ''}`;
  return `${minutes}分钟`;
}

export function bytesToSize(bytes?: number) {
  if (!bytes) return '未知大小';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unit]}`;
}

export function bitrateToText(bitrate?: number) {
  if (!bitrate) return '未知码率';
  if (bitrate > 1_000_000) return `${(bitrate / 1_000_000).toFixed(1)} Mbps`;
  return `${Math.round(bitrate / 1000)} Kbps`;
}

export function getErrorMessage(error: unknown) {
  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return '无法直接连接 Emby 服务器。若账号能登录但媒体列表拉不下来，通常是 Emby 或反代没有放行 CORS。';
  }
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '操作失败，请稍后再试';
}
