/** Tags each submission so results of a superseded or invalidated one can be dropped. */
export function createSubmissionGuard() {
  let current = 0;
  return {
    begin: (): number => ++current,
    invalidate: (): void => {
      current += 1;
    },
    isCurrent: (token: number): boolean => token === current,
  };
}
