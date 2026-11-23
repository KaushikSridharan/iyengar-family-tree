import { getParents } from './graph.js';

function getNeighbors(graph, id) {
  const neighbors = [];
  const seen = new Set();

  for (const p of getParents(graph, id)) {
    const key = `parent:${p.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      neighbors.push({ id: p.id, edge: 'parent' });
    }
  }

  for (const c of graph.childrenByParent.get(id) || []) {
    const key = `child:${c.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      neighbors.push({ id: c.id, edge: 'child' });
    }
  }

  for (const u of graph.unionsByPerson.get(id) || []) {
    const spouseId = u.partners[0] === id ? u.partners[1] : u.partners[0];
    if (graph.peopleById.has(spouseId)) {
      const key = `spouse:${spouseId}`;
      if (!seen.has(key)) {
        seen.add(key);
        neighbors.push({ id: spouseId, edge: 'spouse' });
      }
    }
  }

  return neighbors;
}

function genderedTerm(gender, female, male, neutral) {
  if (gender === 'f') return female;
  if (gender === 'm') return male;
  return neutral;
}

function ordinalWord(n) {
  if (n === 1) return 'first';
  if (n === 2) return 'second';
  if (n === 3) return 'third';
  if (n === 4) return 'fourth';
  return `${n}th`;
}

function removedPhrase(diff) {
  if (diff === 1) return 'once removed';
  if (diff === 2) return 'twice removed';
  return `${diff} times removed`;
}

function describeBloodSegment(upSteps, downSteps, targetGender, sideHint, vocab) {
  if (upSteps === 0 && downSteps === 0) return 'you';

  if (downSteps === 0) {
    if (upSteps === 1) {
      if (vocab === 'marathi') return genderedTerm(targetGender, 'Aai (mother)', 'Baba (father)', 'parent');
      return genderedTerm(targetGender, 'mother', 'father', 'parent');
    }
    if (upSteps === 2) {
      if (vocab === 'marathi') {
        if (sideHint === 'mother') return genderedTerm(targetGender, 'Aaji (maternal grandmother)', 'Ajoba (maternal grandfather)', 'grandparent');
        if (sideHint === 'father') return genderedTerm(targetGender, 'Aaji (paternal grandmother)', 'Ajoba (paternal grandfather)', 'grandparent');
        return genderedTerm(targetGender, 'Aaji (grandmother)', 'Ajoba (grandfather)', 'grandparent');
      }
      return genderedTerm(targetGender, 'grandmother', 'grandfather', 'grandparent');
    }
    return `${'great-'.repeat(upSteps - 2)}${genderedTerm(targetGender, 'grandmother', 'grandfather', 'grandparent')}`;
  }

  if (upSteps === 0) {
    if (downSteps === 1) return genderedTerm(targetGender, 'daughter', 'son', 'child');
    if (downSteps === 2) return genderedTerm(targetGender, 'granddaughter', 'grandson', 'grandchild');
    return `${'great-'.repeat(downSteps - 2)}${genderedTerm(targetGender, 'granddaughter', 'grandson', 'grandchild')}`;
  }

  if (upSteps === 1 && downSteps === 1) {
    if (vocab === 'marathi') return genderedTerm(targetGender, 'Bahin (sister)', 'Bhau (brother)', 'sibling');
    return genderedTerm(targetGender, 'sister', 'brother', 'sibling');
  }

  if (downSteps === 1 && upSteps >= 2) {
    if (upSteps === 2 && vocab === 'marathi') {
      if (sideHint === 'father') return genderedTerm(targetGender, 'Atya (paternal aunt)', 'Kaka (paternal uncle)', 'paternal aunt/uncle');
      if (sideHint === 'mother') return genderedTerm(targetGender, 'Mavshi (maternal aunt)', 'Mama (maternal uncle)', 'maternal aunt/uncle');
    }
    const base = genderedTerm(targetGender, 'aunt', 'uncle', 'aunt or uncle');
    if (upSteps === 2) return base;
    return `${'great-'.repeat(upSteps - 2)}${base}`;
  }

  if (upSteps === 1 && downSteps >= 2) {
    const base = genderedTerm(targetGender, 'niece', 'nephew', 'niece or nephew');
    if (downSteps === 2) return base;
    return `${'great-'.repeat(downSteps - 2)}${base}`;
  }

  const degree = Math.min(upSteps, downSteps) - 1;
  const removed = Math.abs(upSteps - downSteps);
  let cousinLabel = `${ordinalWord(degree)} cousin`;
  if (removed > 0) cousinLabel += ` ${removedPhrase(removed)}`;
  if (sideHint) cousinLabel += ` on your ${sideHint}'s side`;
  return cousinLabel;
}

export function summarizeConnection(steps, nodes, vocab = 'english') {
  if (steps.length === 0) return 'you';

  let firstChildIdx = steps.findIndex((s) => s.edge !== 'parent');
  if (firstChildIdx === -1) firstChildIdx = steps.length;
  const isPureBlood = steps.every((s, idx) =>
    idx < firstChildIdx ? s.edge === 'parent' : s.edge === 'child'
  );

  const firstParentGender = steps[0]?.edge === 'parent' ? nodes[1]?.gender : undefined;
  const sideHint =
    firstParentGender === 'f' ? 'mother' : firstParentGender === 'm' ? 'father' : null;

  if (isPureBlood) {
    const up = firstChildIdx;
    const down = steps.length - firstChildIdx;
    if (up === 1 && down === 1) {
      const aParents = new Set(nodes[0]?.parents || []);
      const bParents = new Set(nodes[2]?.parents || []);
      const shared = [...aParents].filter((p) => bParents.has(p));
      if (aParents.size > 0 && bParents.size > 0 && shared.length === 1 && (aParents.size > 1 || bParents.size > 1)) {
        return genderedTerm(nodes[2]?.gender, 'half-sister', 'half-brother', 'half-sibling');
      }
    }
    return describeBloodSegment(up, down, nodes[nodes.length - 1]?.gender, sideHint, vocab);
  }

  if (steps.length === 1 && steps[0].edge === 'spouse') {
    if (vocab === 'marathi') return genderedTerm(nodes[1]?.gender, 'Patni (wife)', 'Pati (husband)', 'spouse');
    return genderedTerm(nodes[1]?.gender, 'wife', 'husband', 'spouse');
  }

  const edges = steps.map((s) => s.edge).join('>');
  const lastGender = nodes[nodes.length - 1]?.gender;

  if (edges === 'spouse>parent') return genderedTerm(lastGender, 'mother-in-law', 'father-in-law', 'parent-in-law');
  if (edges === 'child>spouse') return genderedTerm(lastGender, 'daughter-in-law', 'son-in-law', 'child-in-law');
  if (edges === 'parent>child>spouse' || edges === 'spouse>parent>child') return genderedTerm(lastGender, 'sister-in-law', 'brother-in-law', 'sibling-in-law');
  if (edges === 'parent>spouse') return genderedTerm(lastGender, 'stepmother', 'stepfather', 'stepparent');
  if (edges === 'spouse>child') return genderedTerm(lastGender, 'stepdaughter', 'stepson', 'stepchild');

  const spouseIndices = steps
    .map((s, idx) => (s.edge === 'spouse' ? idx : -1))
    .filter((i) => i >= 0);

  if (spouseIndices.length === 1) {
    const idx = spouseIndices[0];
    const before = steps.slice(0, idx);
    const after = steps.slice(idx + 1);
    const afterAllDownOrUp = after.every((s) => s.edge === 'child') || after.every((s) => s.edge === 'parent');

    if (before.length > 0 && after.length === 0) {
      const beforeSummary = summarizeConnection(before, nodes.slice(0, idx + 1), vocab);
      const spouseTerm = genderedTerm(lastGender, 'wife', 'husband', 'spouse');
      return `${beforeSummary}'s ${spouseTerm}`;
    }

    if (idx === 0 && after.length > 0 && afterAllDownOrUp) {
      const spouseTerm = genderedTerm(nodes[1]?.gender, 'wife', 'husband', 'spouse');
      const afterSummary = summarizeConnection(after, nodes.slice(1), vocab);
      return `${spouseTerm}'s ${afterSummary}`;
    }
  }

  return `connected through ${steps.length} steps`;
}

export function findShortestConnections(graph, fromId, toId, vocab = 'english', maxPaths = 25) {
  if (!graph.peopleById.has(fromId) || !graph.peopleById.has(toId)) return [];
  if (fromId === toId) return [];

  const dist = new Map([[fromId, 0]]);
  const parentsMap = new Map();
  const queue = [fromId];
  let targetDist = null;

  while (queue.length > 0) {
    const curr = queue.shift();
    const d = dist.get(curr);
    if (targetDist !== null && d >= targetDist) continue;

    for (const next of getNeighbors(graph, curr)) {
      const nextDist = d + 1;
      const knownDist = dist.get(next.id);

      if (knownDist === undefined) {
        dist.set(next.id, nextDist);
        parentsMap.set(next.id, [{ prevId: curr, edge: next.edge }]);
        if (next.id === toId) {
          targetDist = nextDist;
        } else {
          queue.push(next.id);
        }
      } else if (knownDist === nextDist) {
        const arr = parentsMap.get(next.id) || [];
        if (!arr.some((x) => x.prevId === curr && x.edge === next.edge)) {
          arr.push({ prevId: curr, edge: next.edge });
          parentsMap.set(next.id, arr);
        }
      }
    }
  }

  if (targetDist === null) return [];

  const rawPaths = [];
  function backtrack(currId, acc) {
    if (rawPaths.length >= maxPaths * 2) return;
    if (currId === fromId) {
      rawPaths.push([...acc].reverse());
      return;
    }
    for (const p of parentsMap.get(currId) || []) {
      backtrack(p.prevId, [...acc, { id: currId, edge: p.edge }]);
    }
  }

  backtrack(toId, []);

  const results = rawPaths.map((entries) => {
    const nodes = [graph.peopleById.get(fromId)];
    const steps = [];
    let usesMarriage = false;

    for (const item of entries) {
      const prevNode = nodes[nodes.length - 1];
      const nextNode = graph.peopleById.get(item.id);
      const edge = item.edge;
      if (edge === 'spouse') usesMarriage = true;

      let linkLabel = '';
      if (edge === 'child') {
        linkLabel = genderedTerm(prevNode.gender, 'mother of', 'father of', 'parent of');
      } else if (edge === 'parent') {
        linkLabel = genderedTerm(prevNode.gender, 'daughter of', 'son of', 'child of');
      } else {
        linkLabel = genderedTerm(prevNode.gender, 'wife of', 'husband of', 'spouse of');
      }

      steps.push({
        fromId: prevNode.id,
        toId: nextNode.id,
        edge,
        linkLabel,
        isMarriage: edge === 'spouse',
      });
      nodes.push(nextNode);
    }

    return {
      nodes,
      steps,
      usesMarriage,
      summary: summarizeConnection(steps, nodes, vocab),
    };
  });

  results.sort((a, b) => Number(a.usesMarriage) - Number(b.usesMarriage));
  return results.slice(0, maxPaths);
}

export function getRelationshipToViewer(graph, viewerId, targetId, vocab = 'english') {
  if (!viewerId || !graph.peopleById.has(viewerId) || !graph.peopleById.has(targetId)) {
    return null;
  }
  if (viewerId === targetId) return 'You';
  const paths = findShortestConnections(graph, viewerId, targetId, vocab, 4);
  if (paths.length === 0) return null;
  return `Your ${paths[0].summary}`;
}
