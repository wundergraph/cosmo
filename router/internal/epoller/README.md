# Epoller

epoll implementation for connections in Linux, MacOS.

Its target is implementing a simple epoll lib for network connections, so you should see it only contains few methods about net.Conn:

This is a copy of [https://github.com/smallnest/epoller](https://github.com/smallnest/epoller) (v1.2.0) to remove Windows support and avoid the need for CGO.
On Windows, we handle websocket messages in a separate goroutine, without epoll.