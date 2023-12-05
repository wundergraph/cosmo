import fs from 'node:fs';
import { Octokit } from 'octokit';
import { Command, program } from 'commander';
import pc from 'picocolors';
import cliProgress from 'cli-progress';
import decompress from 'decompress';
import { join } from 'pathe';
import { BaseCommandOptions } from '../../../core/types/types.js';

export default function (_: BaseCommandOptions) {
  const command = new Command('download-binary');
  command.description('Downloads the latest router binary for the detected machine platform and architecture.');
  command.option('-o, --out [string]', 'Destination directory for the downloaded router binary.');
  command.action(async (options) => {
    const path = join(process.cwd(), options.out ?? './router');
    const fullPath = join(path, 'router');
    if (fs.existsSync(fullPath)) {
      program.error(pc.red(`${fullPath} already exists`));
    }
    const routerTarget = getBinaryTarget();
    const octokit = new Octokit();
    const headers = process.env.GITHUB_TOKEN ? { authorization: `token ${process.env.GITHUB_TOKEN}` } : {};
    const releases = await octokit.request('GET /repos/wundergraph/cosmo/releases', { headers });
    let routerRelease;
    for (const release of releases.data) {
      if (!release.tag_name || !release.tag_name.startsWith('router@')) {
        continue;
      }
      routerRelease = release;
      break;
    }
    let url;
    for (const asset of routerRelease.assets) {
      if (!asset.name.endsWith(routerTarget)) {
        continue;
      }
      url = asset.browser_download_url;
      break;
    }
    const response = await fetch(url);
    const contentLength = response.headers.get('content-length');
    if (!contentLength) {
      program.error(pc.red(`Could not get content-length of file`));
    }
    if (!response.body) {
      program.error(pc.red(`Response had no body`));
    }
    console.log(`Beginning download for ${routerTarget} (${routerRelease.tag_name})\nSource: ${url}\nTarget directory: ${path}/`);
    let loaded = 0;
    const total = Number.parseInt(contentLength, 10);
    const bar = new cliProgress.SingleBar({});
    bar.start(total, 0);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    for await (const chunk of readChunks(reader)) {
      loaded += chunk.byteLength;
      bar.update(loaded);
      chunks.push(chunk);
    }
    bar.stop();
    await decompress(Buffer.from(await new Blob(chunks).arrayBuffer()), path);
  });
  return command;
}

function getBinaryTarget(): string {
  const tarSuffix = '.tar.gz';
  const zipSuffix = '.zip';
  switch (process.platform) {
    case 'darwin': {
      switch (process.arch) {
        case 'arm64': {
          return 'darwin-arm64' + tarSuffix;
        }
        case 'x64': {
          return 'darwin-amd64' + tarSuffix;
        }
        default: {
          program.error(pc.red(`Unsupported MacOS architecture: ${process.arch}`));
        }
      }
      break;
    }
    case 'linux': {
      switch (process.arch) {
        case 'arm64': {
          return 'linux-arm64' + tarSuffix;
        }
        case 'ia32': {
          return 'linux-386' + tarSuffix;
        }
        case 'x64': {
          return 'linux-amd64' + tarSuffix;
        }
        default: {
          program.error(pc.red(`Unsupported Linux architecture: ${process.arch}`));
        }
      }
      break;
    }
    case 'win32': {
      switch (process.arch) {
        case 'x64': {
          return 'windows-amd64' + zipSuffix;
        }
        case 'ia32': {
          return 'windows-386' + zipSuffix;
        }
        default: {
          program.error(pc.red(`Unsupported Windows architecture: ${process.arch}`));
        }
      }
      break;
    }
    default: {
      program.error(pc.red(`Unsupported platform: ${process.platform}`));
    }
  }
}

function readChunks(reader: ReadableStreamDefaultReader<Uint8Array>) {
  return {
    async *[Symbol.asyncIterator]() {
      let readResult = await reader.read();
      while (!readResult.done) {
        yield readResult.value;
        readResult = await reader.read();
      }
    },
  };
}
