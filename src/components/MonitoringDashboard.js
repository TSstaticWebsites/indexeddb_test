import React, { useState, useEffect } from 'react';
import NetworkTopology from './NetworkTopology';
import GeographicDistribution from './GeographicDistribution';
import CircuitHealthDashboard from './CircuitHealthDashboard';
import FileRoutingVisualizer from './FileRoutingVisualizer';
import './MonitoringDashboard.css';

const MonitoringDashboard = ({
  circuit,
  circuitBuilder,
  nodeRegistry,
  currentChunk,
  totalChunks,
  transferDirection,
  onNodeSelect
}) => {
  const [selectedNode, setSelectedNode] = useState(null);
  const [networkMetrics, setNetworkMetrics] = useState({
    activeNodes: 0,
    totalNodes: 0,
    avgLatency: 0,
    circuitHealth: 100
  });

  useEffect(() => {
    if (!circuit || !nodeRegistry) return;

    const updateMetrics = () => {
      const nodes = nodeRegistry.getNodes();
      const activeNodes = nodes.filter(node => node.status === 'AVAILABLE').length;

      setNetworkMetrics({
        activeNodes,
        totalNodes: nodes.length,
        avgLatency: nodeRegistry.getAverageLatency(),
        circuitHealth: circuit ? circuitBuilder.getCircuitHealth(circuit.id) : 0
      });
    };

    updateMetrics();
    const interval = setInterval(updateMetrics, 5000);
    return () => clearInterval(interval);
  }, [circuit, nodeRegistry, circuitBuilder]);

  const handleNodeClick = (nodeId) => {
    setSelectedNode(nodeId);
    if (onNodeSelect) {
      onNodeSelect(nodeId);
    }
  };

  return (
    <div className="monitoring-dashboard">
      <div className="dashboard-header">
        <h2>Network Monitoring Dashboard</h2>
        <div className="network-stats">
          <div className="stat-item">
            <span className="stat-label">Active Nodes</span>
            <span className="stat-value">{networkMetrics.activeNodes}/{networkMetrics.totalNodes}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Avg Latency</span>
            <span className="stat-value">{networkMetrics.avgLatency.toFixed(2)}ms</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Circuit Health</span>
            <span className="stat-value">{networkMetrics.circuitHealth}%</span>
          </div>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="grid-item network-topology">
          <h3>Network Topology</h3>
          <NetworkTopology
            nodes={nodeRegistry?.getNodes() || []}
            circuit={circuit}
            onNodeClick={handleNodeClick}
            selectedNode={selectedNode}
          />
        </div>

        <div className="grid-item geographic-distribution">
          <h3>Geographic Distribution</h3>
          <GeographicDistribution
            nodes={nodeRegistry?.getNodes() || []}
            selectedNode={selectedNode}
            onNodeSelect={handleNodeClick}
          />
        </div>

        <div className="grid-item circuit-health">
          <h3>Circuit Health</h3>
          <CircuitHealthDashboard
            circuit={circuit}
            circuitBuilder={circuitBuilder}
            nodeRegistry={nodeRegistry}
          />
        </div>

        {(currentChunk > 0 || totalChunks > 0) && (
          <div className="grid-item file-routing">
            <h3>File Transfer Progress</h3>
            <FileRoutingVisualizer
              circuit={circuit}
              currentChunk={currentChunk}
              totalChunks={totalChunks}
              transferDirection={transferDirection}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default MonitoringDashboard;
