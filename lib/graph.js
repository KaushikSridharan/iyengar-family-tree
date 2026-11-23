import { extractYear, normalizeSearchText } from './format.js';

// Orders people by birth year (unknown years last), then by name.
export function sortByBirthThenName(a, b) {
  const ya = extractYear(a.born);
  const yb = extractYear(b.born);
  if (ya && yb && ya !== yb) return ya.localeCompare(yb);
  if (ya && !yb) return -1;
  if (!ya && yb) return 1;
  return a.name.localeCompare(b.name);
}

export function buildTreeGraph(data) {
  const peopleById = new Map();
  const childrenByParent = new Map();
  const unionsByPerson = new Map();

  for (const [id, record] of Object.entries(data.people || {})) {
    peopleById.set(id, { ...record, id });
  }

  const peopleList = Array.from(peopleById.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  for (const person of peopleById.values()) {
    for (const pid of person.parents || []) {
      if (!peopleById.has(pid)) continue;
      const list = childrenByParent.get(pid) || [];
      list.push(person);
      childrenByParent.set(pid, list);
    }
  }

  for (const list of childrenByParent.values()) {
    list.sort(sortByBirthThenName);
  }

  (data.unions || []).forEach((union, idx) => {
    const [a, b] = union.partners || [];
    if (!peopleById.has(a) || !peopleById.has(b)) return;
    const enriched = { ...union, _index: idx };
    for (const pid of [a, b]) {
      const list = unionsByPerson.get(pid) || [];
      list.push(enriched);
      unionsByPerson.set(pid, list);
    }
  });

  for (const list of unionsByPerson.values()) {
    list.sort((a, b) => {
      const oa = a.order ?? Number.MAX_SAFE_INTEGER;
      const ob = b.order ?? Number.MAX_SAFE_INTEGER;
      if (oa !== ob) return oa - ob;
      const ma = a.married || '';
      const mb = b.married || '';
      if (ma && mb && ma !== mb) return ma.localeCompare(mb);
      return (a._index ?? 0) - (b._index ?? 0);
    });
  }

  const fallbackStart =
    (data.defaultStartId && peopleById.has(data.defaultStartId) && data.defaultStartId) ||
    peopleList[0]?.id ||
    '';

  return {
    title: data.title || 'Family Tree',
    defaultStartId: fallbackStart,
    lastUpdated: data.lastUpdated,
    peopleById,
    peopleList,
    unions: data.unions || [],
    childrenByParent,
    unionsByPerson,
  };
}

export function getParents(graph, personId) {
  const person = graph.peopleById.get(personId);
  if (!person?.parents) return [];
  return person.parents
    .map((pid) => graph.peopleById.get(pid))
    .filter(Boolean);
}

export function getSiblings(graph, personId) {
  const person = graph.peopleById.get(personId);
  if (!person?.parents || person.parents.length === 0) return [];
  const siblingMap = new Map();

  for (const pid of person.parents) {
    const children = graph.childrenByParent.get(pid) || [];
    for (const child of children) {
      if (child.id !== personId) {
        siblingMap.set(child.id, child);
      }
    }
  }

  return Array.from(siblingMap.values()).sort(sortByBirthThenName);
}

export function getUnionGroups(graph, personId) {
  const personUnions = graph.unionsByPerson.get(personId) || [];
  const allChildren = graph.childrenByParent.get(personId) || [];
  const assignedChildren = new Set();
  const groups = [];

  for (const union of personUnions) {
    const spouseId = union.partners[0] === personId ? union.partners[1] : union.partners[0];
    const spouse = graph.peopleById.get(spouseId) || null;
    const unionChildren = allChildren.filter((child) => {
      const p = child.parents || [];
      return p.includes(personId) && p.includes(spouseId);
    });

    for (const c of unionChildren) assignedChildren.add(c.id);
    groups.push({ union, spouse, children: unionChildren });
  }

  const remaining = allChildren.filter((c) => !assignedChildren.has(c.id));
  if (remaining.length > 0) {
    const byOtherParent = new Map();
    for (const child of remaining) {
      const otherId = (child.parents || []).find((pid) => pid !== personId) || '__single__';
      const arr = byOtherParent.get(otherId) || [];
      arr.push(child);
      byOtherParent.set(otherId, arr);
    }

    for (const [otherId, children] of byOtherParent.entries()) {
      const spouse = otherId === '__single__' ? null : graph.peopleById.get(otherId) || null;
      groups.push({ union: null, spouse, children });
    }
  }

  return groups;
}

export function getDerivedFamily(graph, personId) {
  const person = graph.peopleById.get(personId);
  if (!person) return null;

  return {
    person,
    parents: getParents(graph, personId),
    siblings: getSiblings(graph, personId),
    unions: getUnionGroups(graph, personId),
  };
}

// Direct-line ancestors of `personId`, nearest generation first. Each level holds one
// `{ people, childId }` unit per person in the level below who has recorded parents, in that
// person's order, so levels widen by doubling. People already seen are skipped, which guards
// against cycles in malformed data.
export function getAncestorLevels(graph, personId) {
  const levels = [];
  const seen = new Set([personId]);
  let frontier = [personId];
  while (frontier.length > 0) {
    const level = [];
    for (const childId of frontier) {
      const people = getParents(graph, childId).filter((p) => !seen.has(p.id));
      if (people.length === 0) continue;
      people.forEach((p) => seen.add(p.id));
      level.push({ people, childId });
    }
    if (level.length === 0) break;
    levels.push(level);
    frontier = level.flatMap((u) => u.people.map((p) => p.id));
  }
  return levels;
}

// Descendants starting from `children`, nearest generation first. The first level is a single
// group with `parentId: null`; each later level holds one `{ parentId, kids }` group per person in
// the level above who has recorded children. People already seen are skipped (cycle guard, and a
// child of two descendants is shown once).
export function getDescendantLevels(graph, children) {
  if (children.length === 0) return [];
  const seen = new Set(children.map((c) => c.id));
  const levels = [[{ parentId: null, kids: children }]];
  for (;;) {
    const level = [];
    for (const parent of levels[levels.length - 1].flatMap((g) => g.kids)) {
      const kids = (graph.childrenByParent.get(parent.id) || []).filter((k) => !seen.has(k.id));
      if (kids.length === 0) continue;
      kids.forEach((k) => seen.add(k.id));
      level.push({ parentId: parent.id, kids });
    }
    if (level.length === 0) return levels;
    levels.push(level);
  }
}

export function searchPeople(graph, query) {
  const norm = normalizeSearchText(query);
  if (!norm) return graph.peopleList;
  const tokens = norm.split(/\s+/).filter(Boolean);
  const scored = [];

  for (const person of graph.peopleList) {
    const nameNorm = normalizeSearchText(person.name);
    const fullNorm = person.fullName ? normalizeSearchText(person.fullName) : '';
    const altNorm = person.altName ? normalizeSearchText(person.altName) : '';
    const combined = `${nameNorm} ${fullNorm} ${altNorm}`.trim();

    if (!tokens.every((t) => combined.includes(t))) continue;

    let score = 3;
    if (nameNorm.startsWith(norm) || fullNorm.startsWith(norm)) score = 0;
    else if (
      nameNorm.split(/\s+/).some((w) => w.startsWith(norm)) ||
      fullNorm.split(/\s+/).some((w) => w.startsWith(norm))
    ) {
      score = 1;
    } else if (nameNorm.includes(norm)) {
      score = 2;
    }

    scored.push({ person, score });
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.person.name.localeCompare(b.person.name);
  });

  return scored.map((s) => s.person);
}
