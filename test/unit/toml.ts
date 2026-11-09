export interface ChainSpecFacts {
  systemCells: string[];
  issuedArgs: string[];
}

export function parse(source: string): ChainSpecFacts {
  const systemCells = [...source.matchAll(/\[\[genesis\.system_cells\]\]\r?\nfile = \{ (?:file|bundled) = "([^"]+)" \}/g)].map((m) => m[1]!);
  const issuedArgs = [...source.matchAll(/\[\[genesis\.issued_cells\]\][\s\S]*?lock\.args = "([^"]+)"/g)].map((m) => m[1]!);
  return { systemCells, issuedArgs };
}
