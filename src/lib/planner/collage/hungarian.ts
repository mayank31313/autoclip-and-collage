function assertMatrix(costs: readonly (readonly number[])[]): number {
  const columns = costs[0]?.length ?? 0;
  for (const row of costs) {
    if (row.length !== columns) throw new RangeError("cost matrix is ragged");
    if (!row.every(Number.isFinite)) throw new RangeError("cost matrix must be finite");
  }
  return columns;
}

/**
 * Minimum-cost assignment on a square matrix (Kuhn–Munkres with potentials, O(n^3)).
 * Strict comparisons keep the lowest index on ties, so results are deterministic.
 * Returns, for each row index, the matched column index.
 */
function solveSquare(costs: readonly (readonly number[])[]): number[] {
  const n = costs.length;
  const rowPotential = new Array<number>(n + 1).fill(0);
  const colPotential = new Array<number>(n + 1).fill(0);
  const matchedRow = new Array<number>(n + 1).fill(0); // 1-based; 0 means unmatched
  const way = new Array<number>(n + 1).fill(0);
  for (let row = 1; row <= n; row++) {
    matchedRow[0] = row;
    let column = 0;
    const minSlack = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[column] = true;
      const current = matchedRow[column];
      let delta = Number.POSITIVE_INFINITY;
      let next = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const slack = costs[current - 1][j - 1] - rowPotential[current] - colPotential[j];
        if (slack < minSlack[j]) {
          minSlack[j] = slack;
          way[j] = column;
        }
        if (minSlack[j] < delta) {
          delta = minSlack[j];
          next = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          rowPotential[matchedRow[j]] += delta;
          colPotential[j] -= delta;
        } else {
          minSlack[j] -= delta;
        }
      }
      column = next;
    } while (matchedRow[column] !== 0);
    do {
      const previous = way[column];
      matchedRow[column] = matchedRow[previous];
      column = previous;
    } while (column !== 0);
  }
  const columnOfRow = new Array<number>(n).fill(-1);
  for (let j = 1; j <= n; j++) columnOfRow[matchedRow[j] - 1] = j - 1;
  return columnOfRow;
}

/**
 * Solves the minimum-cost assignment for a rectangular cost matrix. The matrix is padded
 * internally with zero-cost dummy rows/columns; only assignments between real rows and
 * real columns are returned, ordered by row. Throws on ragged or non-finite input.
 * @param costs `costs[row][column]`, unitless
 */
export function solveAssignment(
  costs: readonly (readonly number[])[],
): Array<{ row: number; column: number; cost: number }> {
  const columns = assertMatrix(costs);
  const rows = costs.length;
  if (rows === 0 || columns === 0) return [];
  const size = Math.max(rows, columns);
  const padded = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => (r < rows && c < columns ? costs[r][c] : 0)),
  );
  const result: Array<{ row: number; column: number; cost: number }> = [];
  for (const [row, column] of solveSquare(padded).entries()) {
    if (row < rows && column < columns) result.push({ row, column, cost: costs[row][column] });
  }
  return result;
}
