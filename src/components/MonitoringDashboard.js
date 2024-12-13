import React, { useState, useEffect, useCallback } from 'react';
import NetworkTopology from './NetworkTopology';
import CircuitHealthDashboard from './CircuitHealthDashboard';
import FileRoutingVisualizer from './FileRoutingVisualizer';
import { CircuitStatus } from '../lib/onion/circuitBuilder';
import { NodeStatus } from '../lib/onion/types';
import { CONNECTION_CONSTANTS } from '../lib/onion/constants';
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
    circuitStatus: null,
    message: 'Connecting to network...'
  });

  const updateMetrics = useCallback(() => {
    if (!nodeRegistry?.current) return;

    const metrics = nodeRegistry.current.getNetworkMetrics();
    const localNode = nodeRegistry.current.getLocalNode();

    console.log('[MonitoringDashboard] Updating metrics from registry:', metrics, 'Local node:', localNode);

    setNetworkMetrics(prevMetrics => {
      const updatedMetrics = {
        ...prevMetrics,
        activeNodes: Math.max(1, metrics.activeNodes), // Always include local node
        totalNodes: Math.max(1, metrics.totalNodes),
        readyNodes: metrics.readyNodes || 0,
        avgLatency: nodeRegistry.current.getAvailableBandwidth() || 0,
        circuitHealth: circuit ? circuitBuilder.getCircuitHealth(circuit.id) : 100,
        status: metrics.readyNodes >= CONNECTION_CONSTANTS.MIN_NODES_REQUIRED ? 'READY' : 'WAITING',
        circuitStatus: circuit?.status || null,
        message: `Connected nodes: ${metrics.activeNodes} (${metrics.readyNodes} ready)`,
        localNodeStatus: localNode?.status || 'DISCONNECTED'
      };
      console.log('[MonitoringDashboard] Updated metrics:', updatedMetrics);
      return updatedMetrics;
    });
  }, [nodeRegistry, circuit, circuitBuilder]);

  useEffect(() => {
    console.log('[MonitoringDashboard] Setting up metrics update interval');
    updateMetrics();

    const interval = setInterval(updateMetrics, 5000);
    return () => clearInterval(interval);
  }, [updateMetrics]);

  const handleNodeUpdate = useCallback((event) => {
    console.log('[MonitoringDashboard] Received node update:', event);
    updateMetrics();
  }, [updateMetrics]);

  const handleNetworkMetricsUpdate = useCallback((metrics) => {
    console.log('[MonitoringDashboard] Received network metrics update:', metrics);
    setNetworkMetrics(prevMetrics => {
      const updatedMetrics = {
        ...prevMetrics,
        activeNodes: Math.max(1, metrics.activeNodes), // Always include local node
        totalNodes: Math.max(1, metrics.totalNodes),
        readyNodes: metrics.readyNodes || 0,
        status: metrics.readyNodes >= CONNECTION_CONSTANTS.MIN_NODES_REQUIRED ? 'READY' : 'WAITING',
        message: `Connected nodes: ${metrics.activeNodes} (${metrics.readyNodes} ready)`,
        localNodeStatus: metrics.localNodeStatus || prevMetrics.localNodeStatus
      };
      console.log('[MonitoringDashboard] Updated metrics:', updatedMetrics);
      return updatedMetrics;
    });
  }, []);

  useEffect(() => {
    if (!nodeRegistry?.current) return;

    console.log('[MonitoringDashboard] Setting up event listeners');

    const registry = nodeRegistry.current;
    registry.eventEmitter.on('networkMetricsUpdate', handleNetworkMetricsUpdate);
    registry.eventEmitter.on('nodeUpdate', handleNodeUpdate);

    const metrics = registry.getNetworkMetrics();
    handleNetworkMetricsUpdate(metrics);

    return () => {
      if (registry?.eventEmitter) {
        registry.eventEmitter.removeListener('networkMetricsUpdate', handleNetworkMetricsUpdate);
        registry.eventEmitter.removeListener('nodeUpdate', handleNodeUpdate);
      }
    };
  }, [nodeRegistry, handleNodeUpdate, handleNetworkMetricsUpdate]);

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
                ? networkMetrics.message
                : networkMetrics.status === 'CONNECTING'
                  ? 'Establishing connections...'
                  : networkMetrics.circuitStatus === CircuitStatus.BUILDING
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
                nodes={nodeRegistry.current ? Array.from(nodeRegistry.current.nodes.values()) : []}
                circuit={circuit}
                onNodeClick={handleNodeClick}
                selectedNode={selectedNode}
                isWaiting={networkMetrics.status === 'WAITING'}
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
