module.exports = async ({ github, context, core }) => {
  const item = context.payload.issue ?? context.payload.pull_request;
  const kind = context.payload.issue ? 'issue' : 'pr';
  const login = item.user.login.toLowerCase();
  const headers = {
    Authorization: `Bearer ${process.env.PYLON_API_TOKEN}`,
    'Content-Type': 'application/json',
  };

  // Only public memberships are visible.
  const orgs = (await github.paginate(github.rest.orgs.listForUser, { username: login })).map((o) =>
    o.login.toLowerCase(),
  );

  const candidates = [
    { field: 'github_logins', value: login },
    ...orgs.map((org) => ({ field: 'github_orgs', value: org })),
  ];
  const search = await fetch('https://api.usepylon.com/accounts/search', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      filter: {
        operator: 'or',
        subfilters: candidates.map((c) => ({ ...c, operator: 'string_contains' })),
      },
      limit: 10,
    }),
  });
  if (!search.ok) {
    core.setFailed(`Pylon account search returned ${search.status}: ${await search.text()}`);
    return;
  }

  // string_contains matches substrings, so recheck exactly.
  const listed = (a, field) => (a.custom_fields?.[field]?.value ?? '').split(',').map((v) => v.trim().toLowerCase());
  const { data: accounts } = await search.json();
  const account = accounts.find((a) => candidates.some((c) => listed(a, c.field).includes(c.value)));
  if (!account) {
    core.info(`${login} is not on a customer account, skipping`);
    return;
  }

  const res = await fetch('https://api.usepylon.com/issues', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: `[GitHub ${kind}] ${item.title}`,
      body_html: `<p><a href="${item.html_url}">${item.html_url}</a> opened by ${item.user.login}</p><hr/><pre>${escapeHtml(item.body ?? '')}</pre>`,
      account_id: account.id,
      tags: [`github-${kind}`],
    }),
  });
  if (!res.ok) {
    core.setFailed(`Pylon returned ${res.status}: ${await res.text()}`);
    return;
  }
  core.info(`Created Pylon issue for ${item.html_url}`);
};

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
