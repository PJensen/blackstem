let NEXT_ID = 1;

function resetIds() {
  NEXT_ID = 1;
}

function nextId(prefix) {
  return `${prefix}_${String(NEXT_ID++).padStart(4, "0")}`;
}

function node(type, label, props = {}) {
  return { id: nextId(type.toLowerCase()), type, label, props };
}

function edge(from, relation, to, props = {}) {
  return { from, relation, to, props };
}

function graph() {
  return { nodes: [], edges: [] };
}

function addNode(g, n) {
  g.nodes.push(n);
  return n;
}

function addEdge(g, e) {
  g.edges.push(e);
  return e;
}

function findNodes(g, predicate) {
  return g.nodes.filter(predicate);
}

function firstNode(g, predicate) {
  return g.nodes.find(predicate) || null;
}

function unique(arr) {
  return [...new Set(arr)];
}

export {
  addEdge,
  addNode,
  edge,
  findNodes,
  firstNode,
  graph,
  nextId,
  node,
  resetIds,
  unique,
};