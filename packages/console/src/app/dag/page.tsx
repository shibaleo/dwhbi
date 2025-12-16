export default function DagPage() {
  return (
    <div className="h-screen w-full">
      <iframe
        src="/dbt-docs/index.html"
        className="w-full h-full border-0"
        title="dbt DAG Viewer"
      />
    </div>
  );
}
