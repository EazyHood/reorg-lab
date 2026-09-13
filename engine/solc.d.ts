declare module 'solc' {
  const compiler: { compile(input: string): string; version(): string };
  export default compiler;
}
