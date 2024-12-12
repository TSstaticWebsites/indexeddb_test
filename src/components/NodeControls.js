import React, { useState, useEffect } from 'react';
import { NodeRole, NodeStatus } from '../lib/onion/nodeRegistry';
import './NodeControls.css';

const NodeControls = ({ nodeRegistry, circuitBuilder, currentCircuit, onCircuitChange }) => {
  const [availableNodes, setAvailableNodes] = useState([]);
  const [circuitLength, setCircuitLength] = useState(3);
  const [localNodeRole, setLocalNodeRole] = useState(NodeRole.RELAY);
  const [localNodeStatus, setLocalNodeStatus] = useState(NodeStatus.AVAILABLE);

  useEffect(() => {
    const fetchNodes = async () => {
      const nodes = await nodeRegistry.discoverNodes();
      setAvailableNodes(nodes);
    };

    fetchNodes();
    const interval = setInterval(fetchNodes, 10000);
    return () => clearInterval(interval);
  }, [nodeRegistry]);

  const handleRoleChange = async (role) => {
    setLocalNodeRole(role);
    await nodeRegistry.registerAsNode(role);
  };

  const handleStatusChange = (status) => {
    setLocalNodeStatus(status);
    nodeRegistry.updateStatus(status);
  };

  const handleCircuitLengthChange = async (length) => {
    if (length < 3) {
      alert('Minimum circuit length is 3 hops for anonymity');
      return;
    }
    setCircuitLength(length);
    if (currentCircuit) {
      await circuitBuilder.closeCircuit(currentCircuit);
      const { circuitId } = await circuitBuilder.buildCircuit(length);
      onCircuitChange(circuitId);
    }
  };

  return (
    <div className="node-controls">
      <h2>Node Management</h2>

      <div className="control-section">
        <h3>Local Node Settings</h3>
        <div className="control-group">
          <label>Role:</label>
          <select value={localNodeRole} onChange={(e) => handleRoleChange(e.target.value)}>
            <option value={NodeRole.RELAY}>Relay</option>
            <option value={NodeRole.EXIT}>Exit</option>
            <option value={NodeRole.ENTRY}>Entry</option>
          </select>
        </div>

        <div className="control-group">
          <label>Status:</label>
          <select value={localNodeStatus} onChange={(e) => handleStatusChange(e.target.value)}>
            <option value={NodeStatus.AVAILABLE}>Available</option>
            <option value={NodeStatus.BUSY}>Busy</option>
          </select>
        </div>
      </div>

      <div className="control-section">
        <h3>Circuit Settings</h3>
        <div className="control-group">
          <label>Circuit Length (hops):</label>
          <input
            type="number"
            min="3"
            value={circuitLength}
            onChange={(e) => handleCircuitLengthChange(Number(e.target.value))}
          />
          <small>Minimum 3 hops required for anonymity</small>
        </div>
      </div>

      <div className="control-section">
        <h3>Network Nodes ({availableNodes.length})</h3>
        <div className="node-list">
          {availableNodes.map((node) => (
            <div key={node.nodeId} className="node-item">
              <span className="node-role">{node.role}</span>
              <span className={`node-status status-${node.status.toLowerCase()}`}>
                {node.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default NodeControls;
