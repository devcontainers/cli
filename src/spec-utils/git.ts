import fs, { PathLike } from 'fs';
import child_process from 'child_process';
import path from 'path';

import { URI } from 'vscode-uri';

interface GitRepo {
  remote: string;
  ref: string;
  subdir?: string;

  isolateConfig?: boolean;
}

export function cloneGitRepo(remoteUrl: string): string {
  const repo = parseRemoteUrl(remoteUrl);

  return _cloneGitRepo(repo);
}

function fetchArgs(remoteUrl: string, ref: string): Array<string> {
  let args = ['fetch'];

  if (supportsShallowClone(remoteUrl)) {
    args.push('--depth', '1');
  }

  args.push('origin', '--', ref);
  return args;
}

function _cloneGitRepo(repo: GitRepo): string {
  const fetch = fetchArgs(repo.remote, repo.ref);

  const root = fs.mkdtempSync('vscode-dev-containers');
  let [stdout, stderr] = execGitWithinDir(repo, root, 'init');
  if (stderr) {
    throw new Error(`failed to init git repo in ${root}: ${stderr}`);
  }

  [stdout, stderr] = execGitWithinDir(repo, root, 'remote', 'add', 'origin', repo.remote); // prettier-ignore
  if (stderr) {
    throw new Error(
      `failed to add remote ${repo.remote} to ${root}: ${stderr}`
    );
  }

  [stdout, stderr] = execGitWithinDir(repo, root, ...fetch);
  if (stderr) {
    throw new Error(`failed to fetch ${repo.remote}#${repo.ref}: ${stderr}`);
  }

  const checkoutDir = checkoutRepo(repo, root);
  [stdout, stderr] = execGitWithinDir(repo, checkoutDir, 'submodule', 'update', '--init', '--recursive'); // prettier-ignore
  if (stderr) {
    throw new Error(`failed to update submodules: ${stderr}`);
  }

  return root;
}

function checkoutRepo(repo: GitRepo, dir: string): string {
  const [_, stderr] = execGitWithinDir(repo, dir, 'checkout', repo.ref); // prettier-ignore
  if (stderr) {
    const [_, err] = execGitWithinDir(repo, dir, 'checkout', 'FETCH_HEAD'); // prettier-ignore
    if (err) {
      throw new Error(`failed to checkout ${repo.ref}: ${stderr}`);
    }
  }

  if (repo.subdir) {
    const subdir = fs.realpathSync(path.join(dir, repo.subdir));
    if (!subdir.startsWith(dir)) {
      throw new Error(`subdir ${repo.subdir} is outside of ${dir}`);
    }

    if (!fs.statSync(subdir).isDirectory()) {
      throw new Error(`subdir ${repo.subdir} is not a directory`);
    }

    return subdir;
  }

  return dir;
}

function execGitWithinDir(repo: GitRepo, dir: string, ...args: Array<string>) {
  args.push('-c', 'protocol.file.allow=never');
  let env: Record<string, string> = {
    GIT_PROTOCOL_FROM_USER: '0',
    ...process.env,
  };

  if (repo.isolateConfig) {
    env = { ...env, GIT_CONFIG_NOSYSTEM: '1', HOME: '/dev/null' };
  }

  const options = { cwd: dir, env: env };
  const result = child_process.spawnSync('git', args, options);

  return result.stdout.toString(), result.stderr.toString();
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
  return uri.scheme in ['git', 'ssh', 'https', 'http'];
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
