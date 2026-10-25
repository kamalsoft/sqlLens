/* eslint-disable @typescript-eslint/no-explicit-any -- mssql and pg ship no type declarations and @types/* are not installed (no new dependencies); callers use narrow local interfaces. */
declare module 'mssql' {
  const sql: any;
  export default sql;
}
declare module 'pg' {
  const pg: any;
  export default pg;
}
