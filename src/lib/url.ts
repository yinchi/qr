/** Prefix a site path with the configured base, e.g. url('parts') -> '/qr/parts/'. */
export function url(path = ''): string {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
  const trimmed = path.replace(/^\/+|\/+$/g, '');
  return trimmed ? `${base}${trimmed}/` : base;
}
