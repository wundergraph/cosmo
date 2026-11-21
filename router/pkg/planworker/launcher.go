package planworker

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
)

// ProcessLauncher runs every worker as a child process and talks to it over the
// standard input and output of that process.
type ProcessLauncher struct {
	// Command is the executable and its arguments.
	Command []string
	// Env is added to the environment of the router, which the worker inherits.
	// The planner reads environment variables referenced by the graph configuration,
	// so router and worker have to see the same values.
	Env []string
	// Stderr receives everything the worker logs. Defaults to the stderr of the router.
	Stderr io.Writer
}

func (l *ProcessLauncher) Launch() (Conn, error) {
	if len(l.Command) == 0 {
		return nil, errors.New("no command to start the worker")
	}
	cmd := exec.Command(l.Command[0], l.Command[1:]...)
	cmd.Env = append(os.Environ(), l.Env...)
	cmd.Stderr = l.Stderr
	if cmd.Stderr == nil {
		cmd.Stderr = os.Stderr
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start %q: %w", l.Command[0], err)
	}
	return &processConn{cmd: cmd, stdin: stdin, stdout: stdout}, nil
}

type processConn struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout io.ReadCloser
}

func (c *processConn) Read(p []byte) (int, error)  { return c.stdout.Read(p) }
func (c *processConn) Write(p []byte) (int, error) { return c.stdin.Write(p) }

// Close kills the process. Workers keep no state, so there is nothing to shut down
// gracefully, and killing is the only way to stop a worker that is busy planning.
func (c *processConn) Close() error {
	_ = c.stdin.Close()
	_ = c.cmd.Process.Kill()
	// Wait releases the resources of the process and closes stdout.
	_ = c.cmd.Wait()
	return nil
}

// PipeLauncher runs workers inside the current process. It provides none of the
// isolation of a separate process and can't interrupt a busy handler. It exists to
// exercise the protocol in tests.
type PipeLauncher struct {
	NewHandler func() Handler
	Options    ServeOptions
}

func (l *PipeLauncher) Launch() (Conn, error) {
	requestReader, requestWriter := io.Pipe()
	resultReader, resultWriter := io.Pipe()
	go func() {
		err := Serve(requestReader, resultWriter, l.NewHandler(), l.Options)
		_ = requestReader.CloseWithError(err)
		_ = resultWriter.CloseWithError(err)
	}()
	return &pipeConn{reader: resultReader, writer: requestWriter}, nil
}

type pipeConn struct {
	reader *io.PipeReader
	writer *io.PipeWriter
}

func (c *pipeConn) Read(p []byte) (int, error)  { return c.reader.Read(p) }
func (c *pipeConn) Write(p []byte) (int, error) { return c.writer.Write(p) }

func (c *pipeConn) Close() error {
	_ = c.writer.Close()
	_ = c.reader.Close()
	return nil
}
