import React, { useEffect, useRef } from 'react';
import { geoMercator, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import worldData from '../data/world-110m.json';

const GeographicDistribution = ({ nodes = [], currentCircuit = null }) => {
  const svgRef = useRef();
  const width = 800;
  const height = 500;

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const projection = geoMercator()
      .scale(130)
      .translate([width / 2, height / 1.4]);
    const path = geoPath().projection(projection);
    const world = feature(worldData, worldData.objects.countries);

    // Draw world map
    svg.selectAll('path')
      .data(world.features)
      .join('path')
      .attr('d', path)
      .attr('class', 'country')
      .attr('fill', '#e4e4e4')
      .attr('stroke', '#fff')
      .attr('stroke-width', 0.5);

    // Plot nodes
    svg.selectAll('circle')
      .data(nodes)
      .join('circle')
      .attr('cx', d => projection([d.location.longitude, d.location.latitude])[0])
      .attr('cy', d => projection([d.location.longitude, d.location.latitude])[1])
      .attr('r', 5)
      .attr('class', d => `node ${currentCircuit?.nodes.includes(d.nodeId) ? 'circuit-node' : ''}`)
      .attr('fill', d => getNodeColor(d, currentCircuit));

    // Draw circuit connections
    if (currentCircuit) {
      const lines = currentCircuit.nodes.map(nodeId => {
        const node = nodes.find(n => n.nodeId === nodeId);
        return node ? projection([node.location.longitude, node.location.latitude]) : null;
      }).filter(Boolean);

      svg.selectAll('.circuit-line')
        .data([lines])
        .join('path')
        .attr('class', 'circuit-line')
        .attr('d', d => {
          return d3.line()(d);
        })
        .attr('fill', 'none')
        .attr('stroke', '#006600')
        .attr('stroke-width', 2)
        .attr('opacity', 0.6);
    }
  }, [nodes, currentCircuit]);

  const getNodeColor = (node, circuit) => {
    if (circuit?.nodes.includes(node.nodeId)) {
      return '#006600';
    }
    return node.status === 'AVAILABLE' ? '#666' : '#999';
  };

  return (
    <div className="geographic-distribution">
      <svg ref={svgRef} width={width} height={height}>
        <g className="map-container" />
      </svg>
    </div>
  );
};

export default GeographicDistribution;