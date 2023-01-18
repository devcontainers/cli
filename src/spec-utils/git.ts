import os from 'os';
import fs from 'fs/promises';
import child_process from 'child_process';
import path from 'path';

import { URI } from 'vscode-uri';

interface GitRepo {
  remote: string;
  ref: string;
  subdir?: string;
  isolateConfig?: boolean;
}

export function isGitUrl(url: string): boolean {
  const urlPathWithGitSuffix = /.git(?:#.+)?$/;
  const isUrl = url.startsWith('http://') || url.startsWith('https://');

  if (isUrl && urlPathWithGitSuffix.test(url)) {
    return true;
  }

  if (
    url.startsWith('git@') ||
    url.startsWith('git://') ||
    url.startsWith('github.com/')
  ) {
    return true;
  }

  return false;
}

export async function cloneGitRepo(remoteUrl: string): Promise<string> {
  const repo = parseRemoteUrl(remoteUrl);

  return await _cloneGitRepo(repo);
}

function fetchArgs(remoteUrl: string, ref: string): Array<string> {
  let args = ['fetch'];

  if (supportsShallowClone(remoteUrl)) {
    args.push('--depth', '1');
  }

  args.push('origin', '--', ref);
  return args;
}

async function _cloneGitRepo(repo: GitRepo): Promise<string> {
  const fetch = fetchArgs(repo.remote, repo.ref);

  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'vscode-dev-containers-')
  );
  let [, stderr, err] = execGitWithinDir(repo, root, 'init');
  if (err) {
    throw new Error(`failed to init git repo in ${root}: ${stderr}`);
  }

  [, stderr, err] = execGitWithinDir(repo, root, 'remote', 'add', 'origin', repo.remote); // prettier-ignore
  if (err) {
    throw new Error(
      `failed to add remote ${repo.remote} to ${root}: ${stderr}`
    );
  }

  [, stderr, err] = execGitWithinDir(repo, root, ...fetch);
  if (err) {
    throw new Error(`failed to fetch ${repo.remote}#${repo.ref}: ${stderr}`);
  }

  const checkoutDir = await checkoutRepo(repo, root);
  [, stderr, err] = execGitWithinDir(repo, checkoutDir, 'submodule', 'update', '--init', '--recursive'); // prettier-ignore
  if (err) {
    throw new Error(`failed to update submodules: ${stderr}`);
  }

  return root;
}

async function checkoutRepo(repo: GitRepo, dir: string): Promise<string> {
  const [_, stderr, err] = execGitWithinDir(repo, dir, 'checkout', repo.ref); // prettier-ignore
  if (err) {
    const [, , err2] = execGitWithinDir(repo, dir, 'checkout', 'FETCH_HEAD'); // prettier-ignore
    if (err2) {
      throw new Error(`failed to checkout ${repo.ref}: ${stderr}`);
    }
  }

  if (repo.subdir) {
    const subdir = await fs.realpath(path.join(dir, repo.subdir));
    if (!subdir.startsWith(dir)) {
      throw new Error(`subdir ${repo.subdir} is outside of ${dir}`);
    }

    const stats = await fs.stat(subdir);
    if (!stats.isDirectory()) {
      throw new Error(`subdir ${repo.subdir} is not a directory`);
    }

    return subdir;
  }

  return dir;
}

function execGitWithinDir(
  repo: GitRepo,
  dir: string,
  ...args: Array<string>
): [string, string, Error | undefined] {
  args.unshift('-c', 'protocol.file.allow=never');
  let env: Record<string, string> = {
    GIT_PROTOCOL_FROM_USER: '0',
    ...process.env,
  };

  if (repo.isolateConfig) {
    env = { ...env, GIT_CONFIG_NOSYSTEM: '1', HOME: '/dev/null' };
  }

  const options = { cwd: dir, env: env };
  const result = child_process.spawnSync('git', args, options);

  return [result.stdout.toString(), result.stderr.toString(), result.error];
}

function getRefAndSubdir(fragment: string) {
  let [ref, subdir] = fragment.split(':', 2);
  if (!ref) {
    ref = 'master';
  }

  return [ref, subdir];
}

function isGitTransport(url: string): boolean {
  if (url.startsWith('git@')) {
    return true;
  }

  const uri = URI.parse(url);
  return ['git', 'ssh', 'https', 'http'].includes(uri.scheme);
}

function parseRemoteUrl(url: string): GitRepo {
  let repo: GitRepo;

  if (!isGitTransport(url)) {
    url = `https://${url}`;
  }

  if (url.startsWith('git@')) {
    const [remote, fragment] = url.split('#', 2);
    const [ref, subdir] = getRefAndSubdir(fragment);
    repo = { remote, ref, subdir };
  } else {
    const uri = URI.parse(url);
    const [ref, subdir] = getRefAndSubdir(uri.fragment);
    const remoteUri = uri.with({ fragment: undefined });

    repo = { remote: remoteUri.toString(), ref, subdir };
  }

  if (repo.ref.startsWith('-')) {
    throw new Error(`Invalid ref: ${repo.ref}`);
  }

  return repo;
}

function supportsShallowClone(remoteUrl: string): boolean {
  const uri = URI.parse(remoteUrl);
  if (uri.scheme in ['https', 'http']) {
    // Check if the HTTP server is a smart server
    const serviceUrl = remoteUrl + '/info/refs?service=git-upload-pack';

    const req = new XMLHttpRequest();
    // Making a request synchronously
    req.open('GET', serviceUrl, false);
    req.send(null);

    if (req.status !== 200) {
      return false;
    }

    if (
      req.getResponseHeader('Content-Type') !==
      'application/x-git-upload-pack-advertisement'
    ) {
      return false;
    }
    return true;
  }

  // Non-HTTP protocols support shallow clones
  return true;
}
