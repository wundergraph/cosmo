JavaScript source containing a single async arrow function.
The host wraps it as `(<source>)()` and awaits the resulting Promise;
the resolved JSON-serializable value is the tool result.