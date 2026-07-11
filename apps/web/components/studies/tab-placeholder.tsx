/** 波次开发期间的占位视图(Mauve Quiet),后续波次替换为真实内容。 */
export function TabPlaceholder({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="grid h-full place-items-center px-6 py-10">
      <div className="text-center">
        <h2 className="font-display text-display-md text-ink-900">{title}</h2>
        <p className="mx-auto mt-2 max-w-md font-ui text-body-sm text-ink-400">{hint}</p>
      </div>
    </div>
  );
}
