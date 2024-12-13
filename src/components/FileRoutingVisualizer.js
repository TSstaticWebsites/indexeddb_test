import React, { useEffect, useState } from 'react';
import './FileRoutingVisualizer.css';

const FileRoutingVisualizer = ({
  circuit,
  currentChunk = 0,
  totalChunks = 0,
  transferDirection = 'outbound'
}) => {
  const [animationState, setAnimationState] = useState({
    currentNode: 0,
    progress: 0
  });

  useEffect(() => {
    if (!circuit || !circuit.nodes.length) return;

    const progress = (currentChunk / totalChunks) * 100;
    const nodeIndex = Math.floor((progress / 100) * circuit.nodes.length);

    setAnimationState({
      currentNode: nodeIndex,
      progress: progress
    });
  }, [currentChunk, totalChunks, circuit]);

  const renderNode = (nodeId, index) => {
    const isActive = index <= animationState.currentNode;
    const isCurrent = index === animationState.currentNode;

    return (
      <div
        key={nodeId}
        className={`routing-node ${isActive ? 'active' : ''} ${isCurrent ? 'current' : ''}`}
      >
        <div className="node-circle">
          {index + 1}
        </div>
        <div className="node-id">
          {nodeId.slice(0, 8)}...
        </div>
        {index < circuit.nodes.length - 1 && (
          <div className={`connector ${isActive ? 'active' : ''}`} />
        )}
      </div>
    );
  };

  return (
    <div className="file-routing-visualizer">
      <div className="routing-header">
        <h4>File Routing Progress</h4>
        <div className="transfer-stats">
          <span>Chunk: {currentChunk}/{totalChunks}</span>
          <span>Progress: {Math.round(animationState.progress)}%</span>
        </div>
      </div>

      <div className="routing-path">
        {circuit?.nodes.map((nodeId, index) => renderNode(nodeId, index))}
      </div>


      <div className="routing-legend">
        <div className="legend-item">
          <div className="legend-dot active" />
          <span>Processed</span>
        </div>
        <div className="legend-item">
          <div className="legend-dot" />
          <span>Pending</span>
        </div>
        <div className="legend-item">
          <div className="legend-dot current" />
          <span>Current</span>
        </div>
      </div>
    </div>
  );
};

export default FileRoutingVisualizer;
