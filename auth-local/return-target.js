(function(root){'use strict';
 function fromSearch(search){const q=new URLSearchParams(search);if(q.get('returnTo')!=='neeqoo')return '/index.html';const view=['instructions','approvals','jobs','revenue'].includes(q.get('view'))?q.get('view'):'instructions';const id=q.get('job')||'';return '/neeqoo/#'+view+(view==='jobs'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)?'/'+id:'');}
 root.SmileReturnTarget={fromSearch};
})(globalThis);
