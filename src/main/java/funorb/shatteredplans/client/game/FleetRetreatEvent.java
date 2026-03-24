package funorb.shatteredplans.client.game;

import funorb.shatteredplans.map.StarSystem;

public final class FleetRetreatEvent implements TurnEventLog.Event {
  public final StarSystem source;
  public final StarSystem[] targets;
  public final int garrisonAtCollapse;
  public final int minimumGarrisonAtCollapse;
  public int[] quantities;

  public FleetRetreatEvent(final StarSystem source, final int garrisonAtCollapse, final int minimumGarrisonAtCollapse) {
    this.source = source;
    this.targets = null;
    this.garrisonAtCollapse = garrisonAtCollapse;
    this.minimumGarrisonAtCollapse = minimumGarrisonAtCollapse;
  }

  public FleetRetreatEvent(final StarSystem source,
                           final StarSystem[] targets,
                           final int[] quantities,
                           final int garrisonAtCollapse,
                           final int minimumGarrisonAtCollapse) {
    this.source = source;
    this.targets = targets;
    this.quantities = quantities;
    this.garrisonAtCollapse = garrisonAtCollapse;
    this.minimumGarrisonAtCollapse = minimumGarrisonAtCollapse;
  }
}
