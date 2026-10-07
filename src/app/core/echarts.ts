// Tree-shaken ECharts registration. Add chart types/components here as features need them.
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import {
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  ToolboxComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  MarkLineComponent,
  LegendComponent,
  ToolboxComponent,
  AriaComponent,
  CanvasRenderer,
]);

export { echarts };
