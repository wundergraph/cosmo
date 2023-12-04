import fs from 'node:fs';
import { Octokit } from 'octokit';
import { Command } from 'commander';
import pc from 'picocolors';
import cliProgress from 'cli-progress';
import decompress from 'decompress';
import { join } from 'pathe';
import { BaseCommandOptions } from '../../../core/types/types.js';

export default function (_: BaseCommandOptions) {
  const command = new Command('download');
  command.description(
    'Downloads the latest router binary for the detected machine platform and architecture.',
  );
  command.option('-o, --out [string]', 'Destination directory for the downloaded router binary.');
  command.action(async (options) => {
    const path = join(process.cwd(), options.out ?? './router');
    const fullPath = path + '/router';
    if (fs.existsSync(fullPath)) {
      console.log(pc.red(`${path}/router already exists`));
      process.exit(0);
    }
    if (!process.platform) {
      console.log(pc.red(`Could not determine machine platform`));
      process.exit(1);
    }
    if (!process.arch) {
      console.log(pc.red(`Could not determine architecture for ${process.platform} platform`));
      process.exit(1);
    }
    const octokit = new Octokit();
    const headers = process.env.GITHUB_TOKEN
      ? { authorization: `token ${process.env.GITHUB_TOKEN}` }
      : {};
    const releases = await octokit.request('GET /repos/wundergraph/cosmo/releases', {
      headers,
    });
    const tarSuffix = '.tar.gz';
    const zipSuffix = '.zip';
    let routerRelease;
    for (const release of releases.data) {
      if (!release.tag_name || !release.tag_name.startsWith('router@')) {
        continue;
      }
      routerRelease = release;
      break;
    }
    let targetRouter = '';
    switch (process.platform) {
      case 'darwin': {
        switch (process.arch) {
          case 'arm64': {
            targetRouter = 'darwin-arm64' + tarSuffix;
            break;
          }
          case 'x64': {
            targetRouter = 'darwin-amd64' + tarSuffix;
            break;
          }
          default: {
            console.log(pc.red(`Unsupported MacOS architecture: ${process.arch}`));
            process.exit(1);
          }
        }
        break;
      }
      case 'linux': {
        switch (process.arch) {
          case 'arm64': {
            targetRouter = 'linux-arm64' + tarSuffix;
            break;
          }
          case 'ia32': {
            targetRouter = 'linux-386' + tarSuffix;
            break;
          }
          case 'x64': {
            targetRouter = 'linux-amd64' + tarSuffix;
            break;
          }
          default: {
            console.log(pc.red(`Unsupported Linux architecture: ${process.arch}`));
            process.exit(1);
          }
        }
        break;
      }
      case 'win32': {
        switch (process.arch) {
          case 'x64': {
            targetRouter = 'windows-amd64' + zipSuffix;
            break;
          }
          case 'ia32': {
            targetRouter = 'windows-386' + zipSuffix;
            break;
          }
          default: {
            console.log(pc.red(`Unsupported Windows architecture: ${process.arch}`));
            process.exit(1);
          }
        }
        break;
      }
      default: {
        console.log(pc.red(`Unsupported platform: ${process.platform}`));
        process.exit(1);
      }
    }
    if (!targetRouter) {
      console.log(pc.red(`Unsupported platform architecture: ${process.platform}-${process.arch}`));
      process.exit(1);
    }
    let url;
    for (const asset of routerRelease.assets) {
      if (!asset.name.endsWith(targetRouter)) {
        continue;
      }
      url = asset.browser_download_url;
      break;
    }
    const response = await fetch(url);
    const contentLength = response.headers.get('content-length');
    if (!contentLength) {
      console.log(pc.red(`Could not get content-length of file`));
      process.exit(1);
    }
    if (!response.body) {
      console.log(pc.red(`Response had no body`));
      process.exit(1);
    }
    let loaded = 0;
    const total = Number.parseInt(contentLength, 10);
    const bar = new cliProgress.SingleBar({});
    bar.start(total, 0);
    const res = new Response(new ReadableStream({
      async start (controller) {
        const reader = response.body!.getReader();
        while (true) {
          const { done, value } = await reader.read();
          bar.update(loaded);
          if (done) {
            bar.stop();
            break;
          }
          loaded += value.byteLength;
          controller.enqueue(value)
        }
        controller.close();
      }
    }));
    const bytes = Buffer.from(await res.blob().then(blob => blob.arrayBuffer()));
    await decompress(bytes, path);
  });
  return command;
}