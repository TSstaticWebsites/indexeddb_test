import React, { useState, useEffect, useCallback } from 'react';
import NetworkTopology from './NetworkTopology';
import CircuitHealthDashboard from './CircuitHealthDashboard';
import FileRoutingVisualizer from './FileRoutingVisualizer';
import { CircuitStatus } from '../lib/onion/circuitBuilder';
import { NodeStatus, CONNECTION_CONSTANTS } from '../lib/onion/nodeRegistry';
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
    circuitHealth: 100,
    status: 'WAITING',
    circuitStatus: null
  });

  const updateMetrics = useCallback(() => {
    if (!nodeRegistry?.current) {
      setNetworkMetrics({
        activeNodes: 0,
        totalNodes: 0,
        avgLatency: 0,
        circuitHealth: 100,
        status: 'WAITING',
        circuitStatus: null
      });
      return;
    }

    const nodes = Array.from(nodeRegistry.current.nodes.values());
    const activeNodes = nodes.filter(node =>
      node.status === NodeStatus.AVAILABLE || node.status === NodeStatus.WAITING
    ).length;
    const waitingNodes = nodes.filter(node => node.status === NodeStatus.WAITING).length;
    const status = waitingNodes > 0 ? 'WAITING' :
                  activeNodes >= CONNECTION_CONSTANTS.MIN_NODES_REQUIRED ? 'READY' :
                  'CONNECTING';

    setNetworkMetrics({
      activeNodes,
      totalNodes: nodes.length || 1, // Include self if no other nodes
      avgLatency: nodeRegistry.current.getAvailableBandwidth() || 0,
      circuitHealth: circuit ? circuitBuilder.getCircuitHealth(circuit.id) : 0,
      status,
      circuitStatus: circuit?.status || null
    });
  }, [circuit, nodeRegistry, circuitBuilder]);

  useEffect(() => {
    if (!nodeRegistry?.current) return;

    console.log('Setting up MonitoringDashboard event listeners');

    const handleNodeUpdate = () => {
      console.log('Node update received in MonitoringDashboard');
      const nodes = Array.from(nodeRegistry.current.nodes.values());
      const activeNodes = nodes.filter(node =>
        node.status === NodeStatus.AVAILABLE || node.status === NodeStatus.WAITING
      ).length;
      const waitingNodes = nodes.filter(node => node.status === NodeStatus.WAITING).length;
      const status = waitingNodes > 0 ? 'WAITING' :
                    activeNodes >= CONNECTION_CONSTANTS.MIN_NODES_REQUIRED ? 'READY' :
                    'CONNECTING';

      setNetworkMetrics({
        activeNodes,
        totalNodes: nodes.length || 1,
        avgLatency: nodeRegistry.current.getAvailableBandwidth() || 0,
        circuitHealth: circuit ? circuitBuilder.getCircuitHealth(circuit.id) : 100,
        status,
        circuitStatus: circuit?.status || null
      });
    };

    nodeRegistry.current.eventEmitter.on('nodeRegistered', handleNodeUpdate);
    nodeRegistry.current.eventEmitter.on('nodeDisconnected', handleNodeUpdate);

    return () => {
      if (nodeRegistry.current) {
        nodeRegistry.current.eventEmitter.removeListener('nodeRegistered', handleNodeUpdate);
        nodeRegistry.current.eventEmitter.removeListener('nodeDisconnected', handleNodeUpdate);
      }
    };
  }, [nodeRegistry, circuit, circuitBuilder]);

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
            <span className="stat-label">Status</span>
            <span className={`stat-value status-${networkMetrics.status?.toLowerCase()}`}>
              {networkMetrics.status === 'WAITING'
                ? `Connected nodes waiting (${networkMetrics.activeNodes}/${CONNECTION_CONSTANTS.MIN_NODES_REQUIRED} ready)`
                : networkMetrics.status === 'CONNECTING'
                  ? 'Establishing connections...'
                  : networkMetrics.circuitStatus === 'BUILDING'
                    ? 'Building Circuit...'
                    : networkMetrics.circuitStatus || 'Ready for Circuit Building'}
            </span>
          </div>
        </div>
      </div>

      <div className="dashboard-grid">
        {networkMetrics.totalNodes === 0 ? (
          <div className="loading-state">
            <p>Connecting to network...</p>
            <div className="loading-spinner"></div>
          </div>
        ) : (
          <>
            <div className="grid-item network-topology">
              <h3>Network Topology</h3>
              <NetworkTopology
                nodes={Array.from(nodeRegistry.current.nodes.values())}
                circuit={circuit}
                onNodeClick={handleNodeClick}
                selectedNode={selectedNode}
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
          </>
        )}
      </div>
    </div>
  );
};

export default MonitoringDashboard;
