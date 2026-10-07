// Fund and category wording for the controls and the scope line (D-18, D-19). Pure. Labels,
// groups and presets come from funds.json / categories.json; until those load, ids are shown as
// readable words ("special_revenue" -> "Special revenue"), never guessed names.
import { CategoriesFile, FundsFile } from './models';

export function humanize(id: string): string {
  const words = id.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function fundLabel(id: string, meta: FundsFile | null): string {
  return meta?.funds.find((f) => f.id === id)?.label ?? humanize(id);
}

export function categoryLabel(id: string, meta: CategoriesFile | null): string {
  return meta?.find((c) => c.id === id)?.label ?? humanize(id);
}

export interface FundGroup {
  id: string;
  label: string;
  funds: { id: string; label: string }[];
}

/**
 * Available funds grouped as funds.json says, in its order; one group without it. Funds with their
 * own control (custodial, `handledByToggle`) are left out.
 */
export function fundGroups(available: readonly string[], meta: FundsFile | null): FundGroup[] {
  if (!meta) return [{ id: 'all', label: 'Funds', funds: available.map((id) => ({ id, label: humanize(id) })) }];
  const custodial = new Set(meta.funds.filter((f) => f.handledByToggle).map((f) => f.id));
  const groups = meta.groups.map((g) => ({
    id: g.id,
    label: g.label,
    funds: meta.funds
      .filter((f) => f.group === g.id && !custodial.has(f.id) && available.includes(f.id))
      .map((f) => ({ id: f.id, label: f.label })),
  }));
  // Any available fund the metadata doesn't list still appears (never dropped silently).
  const listed = new Set(groups.flatMap((g) => g.funds.map((f) => f.id)));
  const other = available.filter((id) => !listed.has(id) && !custodial.has(id));
  if (other.length) groups.push({ id: 'other', label: 'Other funds', funds: other.map((id) => ({ id, label: humanize(id) })) });
  return groups.filter((g) => g.funds.length > 0);
}

/**
 * The preset the selection equals, if any. `selection` null means all funds; a preset matches
 * when its funds (limited to those available) are exactly the selection. Otherwise "custom".
 */
export function matchingPreset(
  selection: readonly string[] | null,
  available: readonly string[],
  meta: FundsFile | null,
): string | 'custom' {
  const selected = new Set(selection ?? available);
  for (const p of meta?.presets ?? []) {
    const members = p.funds.filter((id) => available.includes(id));
    if (members.length === selected.size && members.every((id) => selected.has(id))) return p.id;
  }
  return 'custom';
}

/**
 * Plain statement of the fund scope for the line under the chart title: the preset's name when the
 * selection is a preset, else the funds named. Custodial is stated separately by the caller.
 */
export function fundScopeText(
  selection: readonly string[] | null,
  available: readonly string[],
  meta: FundsFile | null,
): string {
  const preset = matchingPreset(selection, available, meta);
  const p = meta?.presets.find((x) => x.id === preset);
  if (p) return p.label;
  if (selection === null) return 'All funds as reported by EDR';
  const names = inMetaOrder(selection, meta).map((id) => fundLabel(id, meta));
  return names.length <= 3 ? `Funds: ${names.join(', ')}` : `Funds: ${names.length} of ${available.length} selected`;
}

/**
 * What a preset or the full selection includes, named fund by fund (QA-07): "Includes General,
 * Special Revenue and Component Units." Only funds this county reports are named.
 */
export function fundsIncludedText(
  funds: readonly string[],
  available: readonly string[],
  meta: FundsFile | null,
): string {
  const names = inMetaOrder(funds.filter((id) => available.includes(id)), meta).map((id) => fundLabel(id, meta));
  if (names.length === 0) return '';
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Includes ${list}.`;
}

/** Fund ids in funds.json order (the EDR column order); ids it doesn't list keep their order, last. */
function inMetaOrder(ids: readonly string[], meta: FundsFile | null): string[] {
  const order = meta?.funds.map((f) => f.id) ?? [];
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
  return [...ids].sort((a, b) => rank(a) - rank(b));
}
