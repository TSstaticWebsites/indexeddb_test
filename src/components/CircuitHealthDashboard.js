import React, { useEffect, useState } from 'react';
import './CircuitHealthDashboard.css';
import { CircuitStatus } from '../lib/onion/circuitBuilder';
import { NodeStatus, CONNECTION_CONSTANTS } from '../lib/onion/nodeRegistry';

const CircuitHealthDashboard = ({
  circuit = {
    bandwidth: 0,
    status: 'WAITING',
    nodes: []
  },
  health = {
    nodeDetails: [],
    metrics: { averageLatency: 0, reliability: 0, bandwidth: 0 },
    healthyNodes: 0,
    totalNodes: 0
  },
  onStatusChange
}) => {
  const [buildingProgress, setBuildingProgress] = useState(0);

  useEffect(() => {
    if (circuit?.status === CircuitStatus.BUILDING) {
      const interval = setInterval(() => {
        setBuildingProgress(prev => (prev >= 90 ? 90 : prev + 10));
      }, 500);
      return () => clearInterval(interval);
    } else if (circuit?.status === CircuitStatus.READY) {
      setBuildingProgress(100);
    }
  }, [circuit?.status]);

  const getHealthStatus = (metric) => {
    if (metric > 80) return 'excellent';
    if (metric > 60) return 'good';
    if (metric > 40) return 'fair';
    return 'poor';
  };

  const formatBandwidth = (bw) => {
    if (bw >= 1024 * 1024) return `${(bw / (1024 * 1024)).toFixed(1)} MB/s`;
    if (bw >= 1024) return `${(bw / 1024).toFixed(1)} KB/s`;
    return `${bw.toFixed(1)} B/s`;
  };

  const calculateNodeHealth = () => {
    if (!health || !health.nodeDetails) return 0;
    const totalNodes = health.nodeDetails.length;
    if (totalNodes === 0) return 0;
    const healthyNodes = health.nodeDetails.filter(n => n.status === 'AVAILABLE').length;
    return Math.round((healthyNodes / totalNodes) * 100);
  };

  return (
    <div className="circuit-health-dashboard">
      <h3>Circuit Health Metrics</h3>

      <div className="metrics-grid">
        <div className="metric-card">
          <h4>Circuit Status</h4>
          <div className={`metric-value status-${circuit?.status?.toLowerCase() || 'unknown'}`}>
            {circuit?.status || 'Unknown'}
            {circuit?.status === CircuitStatus.BUILDING && (
              <div className="building-progress">
                <div className="progress-bar" style={{ width: `${buildingProgress}%` }}></div>
                <span>{buildingProgress}%</span>
              </div>
            )}
          </div>
        </div>

        <div className="metric-card">
          <h4>Node Health</h4>
          <div className={`metric-value ${getHealthStatus(calculateNodeHealth())}`}>
            {calculateNodeHealth()}%
          </div>
          <div className="metric-label">
            {health?.healthyNodes || 0}/{health?.totalNodes || 0} nodes active
            {health?.totalNodes < CONNECTION_CONSTANTS.MIN_NODES_REQUIRED && (
              <span className="waiting-message"> (Waiting for more nodes...)</span>
            )}
          </div>
        </div>

        <div className="metric-card">
          <h4>Network Latency</h4>
          <div className="metric-value">
            {health?.metrics?.averageLatency || 0}ms
          </div>
          <div className="metric-label">Average Response Time</div>
        </div>

        <div className="metric-card">
          <h4>Network Reliability</h4>
          <div className="metric-value">
            {health?.metrics?.reliability || 0}%
          </div>
          <div className="metric-label">Connection Success Rate</div>
        </div>

        <div className="metric-card">
          <h4>Circuit Bandwidth</h4>
          <div className="metric-value">
            {formatBandwidth(circuit?.bandwidth || 0)}
          </div>
          <div className="metric-label">Current Transfer Speed</div>
        </div>
      </div>

      {health?.nodeDetails ? (
        <div className="node-details">
          <h4>Node Details</h4>
          <div className="node-grid">
            {health.nodeDetails.map((node, index) => (
              <div key={node.nodeId} className={`node-card status-${node.status.toLowerCase()}`}>
                <div className="node-header">
                  <span className="node-id">{node.nodeId.slice(0, 8)}...</span>
                  <span className="node-role">{node.role}</span>
                  <span className={`node-status status-${node.status.toLowerCase()}`}>
                    {node.status}
                  </span>
                </div>
                <div className="node-metrics">
                  <div className="node-metric">
                    <span className="label">Latency:</span>
                    <span className="value">{node.metrics?.latency || 0}ms</span>
                  </div>
                  <div className="node-metric">
                    <span className="label">Reliability:</span>
                    <span className="value">{node.metrics?.reliability || 0}%</span>
                  </div>
                  {node.location && (
                    <div className="node-metric">
                      <span className="label">Region:</span>
                      <span className="value">{node.location.region || 'Unknown'}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="node-details-loading">
          <p>Waiting for nodes to connect...</p>
        </div>
      )}
    </div>
  );
};

export default CircuitHealthDashboard;
