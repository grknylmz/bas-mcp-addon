import { spawn } from 'node:child_process';

export function spawnWithPty(command, options) {
  if (process.platform === 'darwin') {
    return spawn('python3', ['-c', 'import os,pty,sys; status=pty.spawn(["/bin/sh","-c",sys.argv[1]]); code=os.waitstatus_to_exitcode(status); sys.exit(code if code >= 0 else 128-code)', command], options);
  }
  return spawn('script', ['-qec', command, '/dev/null'], options);
}
