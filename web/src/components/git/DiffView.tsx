export default function DiffView({ diff }: { diff: string }) {
  if (!diff.trim()) return <div className="p-4 text-[12px] text-faint">no changes</div>;
  return (
    <pre className="mono overflow-x-auto p-2.5 text-[11px] leading-[1.45]">
      {diff.split('\n').map((line, i) => {
        let cls = '';
        if (line.startsWith('+') && !line.startsWith('+++')) cls = 'diff-line-add';
        else if (line.startsWith('-') && !line.startsWith('---')) cls = 'diff-line-del';
        else if (line.startsWith('@@')) cls = 'diff-line-hunk';
        else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---'))
          cls = 'diff-line-meta';
        return (
          <div key={i} className={cls + ' whitespace-pre-wrap break-all px-1'}>
            {line || ' '}
          </div>
        );
      })}
    </pre>
  );
}
