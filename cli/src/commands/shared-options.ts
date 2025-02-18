import { Command } from 'commander';

type CommandOptionParameters = typeof Command.prototype.option.arguments;

export const customRpcHeadersOption: CommandOptionParameters = [
  '-H, --header [headers...]',
  'Specify custom headers for authentication purposes. The headers are passed in the format <key>=<value> <key>=<value>. Use quotes if values include spaces or special characters, e.g. "My-Custom-Header"="Value with spaces"',
  [],
];
