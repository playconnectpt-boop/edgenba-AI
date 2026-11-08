export type EspnInjuryReport = {
  valid: boolean;
  statuses: Map<string, string>;
};

export function parseEspnInjuryReport(payload: unknown): EspnInjuryReport {
  const empty = (): EspnInjuryReport => ({ valid: false, statuses: new Map() });

  if (!payload || typeof payload !== 'object') return empty();

  const wrapper = payload as Record<string, unknown>;
  const root = wrapper.data && typeof wrapper.data === 'object'
    ? wrapper.data as Record<string, unknown>
    : wrapper;

  if (!Array.isArray(root.injuries)) return empty();

  const statuses = new Map<string, string>();
  const seen = new Set<object>();

  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seen.has(value as object)) return;
    seen.add(value as object);

    if (Array.isArray(value)) {
      for (const child of value) walk(child);
      return;
    }

    const node = value as Record<string, unknown>;
    const athlete = node.athlete && typeof node.athlete === 'object'
      ? node.athlete as Record<string, unknown>
      : null;

    if (athlete) {
      const links = Array.isArray(athlete.links) ? athlete.links : [];
      const hrefs = links
        .filter((link): link is Record<string, unknown> => !!link && typeof link === 'object')
        .map(link => String(link.href || ''));

      // Preferir o URL do perfil NBA da ESPN. Só usar outro URL com ID
      // quando todos os links identificados apontarem para o mesmo ID.
      const profileId = hrefs
        .map(href => href.match(/\/nba\/player\/[^?#]*?\/id\/(\d+)(?:\/|$)/i)?.[1])
        .find(Boolean);

      const otherIds = [...new Set(hrefs
        .map(href => href.match(/\/id\/(\d+)(?:\/|$)/i)?.[1])
        .filter((id): id is string => !!id))];

      const athleteId = profileId || (otherIds.length === 1 ? otherIds[0] : '');

      const rawStatus = node.status ?? athlete.status ?? node.injuryStatus;
      const status = typeof rawStatus === 'string'
        ? rawStatus
        : rawStatus && typeof rawStatus === 'object'
          ? (() => {
              const obj = rawStatus as Record<string, unknown>;
              const nested = obj.type && typeof obj.type === 'object'
                ? obj.type as Record<string, unknown>
                : {};
              return String(
                nested.description || nested.name ||
                obj.description || obj.name || obj.abbreviation || ''
              );
            })()
          : '';

      if (athleteId && status) {
        const label = /suspend/i.test(status) ? 'SUSPENSO'
  : /question|day.to.day/i.test(status) ? 'QUESTIONÁVEL'
  : /doubt/i.test(status) ? 'DUVIDOSO'
  : /inactive/i.test(status) ? 'INATIVO'
  : /out|injur/i.test(status) ? 'LESIONADO'
  : '';

        if (label) statuses.set(athleteId, label);
      }
    }

    for (const child of Object.values(node)) walk(child);
  };

  walk(root.injuries);
  return { valid: true, statuses };
}
