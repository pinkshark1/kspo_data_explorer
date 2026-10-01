// 샘플 행 표. compact 이면 한글 컬럼명 + 앞 3행만 보여주는 요약 표로 쓴다.
export default function SampleTable({ detail, compact = false }) {
  const rows = compact ? detail.rows.slice(0, 3) : detail.rows;
  return (
    <div className={`data-table-wrap ${compact ? "compact" : ""} ${detail.apiSample ? "api-sample" : ""}`}>
      <table className="data-table">
        <thead>
          <tr>
            {detail.tableColumns.map((column) => (
              <th key={column.name}>{compact ? column.label : column.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((value, columnIndex) => (
                <td key={`${rowIndex}-${columnIndex}`}>{value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
