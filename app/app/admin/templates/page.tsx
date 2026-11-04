import { requireCtx, requirePermPage } from '@/server/auth/request';
import { listTemplates } from '@/server/services/templates';
import { listStructure } from '@/server/services/structure';
import { PageHeader } from '@/components/page-header';
import { TemplatesAdmin } from '@/components/admin/templates-admin';
import { Empty } from '@/components/ui/empty';

export const metadata = { title: 'Goal library' };

export default async function TemplatesPage() {
  const ctx = await requireCtx(); requirePermPage(ctx, 'templates.manage');
  const [templates, s] = await Promise.all([listTemplates(ctx), listStructure(ctx)]);
  return (<div><PageHeader title="Goal library" description="Reusable goal structures — company-wide or for one department. People can start a new goal from any template. You can also save an existing goal as a template from its page." />
    {templates.length === 0 && <div className="mb-4"><Empty title="The library is empty">Create a template to give people a measurable starting point.</Empty></div>}
    <TemplatesAdmin templates={templates as any[]} departments={s.departments as any} /></div>);
}
