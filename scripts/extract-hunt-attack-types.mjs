import fs from 'node:fs';

const dumpPath = process.argv[2];

if (!dumpPath) {
  throw new Error('Informe o caminho do ws-dump.jsonl.');
}

const aliases = new Map([
  ["Farfetch'd", 'Farfetchd'],
  ['Farfetch’d', 'Farfetchd'],
  ['Mr. Mime', 'MrMime'],
  ['Nidoran♀', 'NidoranF'],
  ['Nidoran♂', 'NidoranM'],
  ['NidoranFemale', 'NidoranF'],
  ['NidoranMale', 'NidoranM'],
]);

const lines = fs.readFileSync(dumpPath, 'utf8').split(/\r?\n/).filter(Boolean);
let hunts = null;

for (const line of lines) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    continue;
  }

  if (
    typeof entry?.url === 'string'
    && entry.url.includes('/map/hunts.json')
    && typeof entry.raw === 'string'
  ) {
    const payload = JSON.parse(entry.raw);
    if (Array.isArray(payload.hunts)) hunts = payload.hunts;
  }
}

if (!hunts) {
  throw new Error('Nenhuma resposta de /map/hunts.json foi encontrada no dump.');
}

const bySpecies = new Map();
const conflicts = [];
const elementCounts = {};
let elementalHunts = 0;
let multiSpeciesElementalHunts = 0;

for (const hunt of hunts) {
  if (hunt.elemental !== true || typeof hunt.element !== 'string') continue;

  elementalHunts += 1;
  const element = hunt.element.trim().toLowerCase();
  elementCounts[element] = (elementCounts[element] ?? 0) + 1;

  const rawSpecies = Array.isArray(hunt.species) && hunt.species.length > 0
    ? hunt.species
    : Array.isArray(hunt.pool)
      ? hunt.pool
      : [];

  if (rawSpecies.length > 1) multiSpeciesElementalHunts += 1;

  for (const rawName of rawSpecies) {
    if (typeof rawName !== 'string' || !rawName.trim()) continue;

    const trimmedName = rawName.trim();
    const species = aliases.get(trimmedName) ?? trimmedName;
    const previous = bySpecies.get(species);

    if (previous && previous !== element) {
      conflicts.push({ species, first: previous, second: element, huntId: hunt.id });
      continue;
    }

    bySpecies.set(species, element);
  }
}

const mappings = [...bySpecies]
  .map(([species, attack_type_code]) => ({ species, attack_type_code }))
  .sort((a, b) => a.species.localeCompare(b.species));

process.stdout.write(`${JSON.stringify({
  totalHunts: hunts.length,
  elementalHunts,
  multiSpeciesElementalHunts,
  uniqueSpecies: mappings.length,
  conflicts,
  elementCounts,
  mappings,
}, null, 2)}\n`);
