namespace Cloudheat.Api;

public sealed class WorkOrderRow
{
    public int WoId { get; init; }
    public string WoNo { get; init; } = "";
    public string DueDate { get; init; } = "";      // 'YYYY-MM-DD'
    public short LineId { get; init; }
    public string LineName { get; init; } = "";
    public string ItemCode { get; init; } = "";
    public string ItemName { get; init; } = "";
    public string WorkerName { get; init; } = "";
    public int PlanQty { get; init; }
    public int ProdQty { get; init; }
    public int DefectQty { get; init; }
    public string Remark { get; init; } = "";
    public string Status { get; init; } = "";
    public DateTime UpdatedAt { get; init; }
}

public sealed record UpdateWorkOrder(int? ProdQty, int? DefectQty, string? Remark);

public sealed class ProcessStep
{
    public short Seq { get; init; }
    public string StepName { get; init; } = "";
    public int InQty { get; init; }
    public int OutQty { get; init; }
    public int LossQty { get; init; }
}

public sealed class DefectCount
{
    public string DefectName { get; init; } = "";
    public int Qty { get; init; }
}

public sealed record WorkOrderDetail(IEnumerable<ProcessStep> Process, IEnumerable<DefectCount> Defects);

public sealed record UpdateResult(WorkOrderRow? Row = null, string? Error = null, bool NotFound = false, string? DocNo = null);
