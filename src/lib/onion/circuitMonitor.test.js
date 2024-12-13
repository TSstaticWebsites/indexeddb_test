import { CircuitMonitor } from './circuitMonitor';
import { CircuitStatus } from './circuitBuilder';
import { NodeStatus } from './types';

describe('CircuitMonitor', () => {
  let monitor;
  let mockCircuitBuilder;
  let mockNodeRegistry;
  let mockCircuit;

  beforeEach(() => {
    mockCircuit = 'test-circuit-id';

    mockCircuitBuilder = {
      getCircuitNodes: jest.fn().mockReturnValue(['node1', 'node2', 'node3']),
      buildCircuit: jest.fn().mockResolvedValue('new-circuit-id'),
      replaceCircuitNode: jest.fn().mockResolvedValue(true),
      migrateCircuitData: jest.fn().mockResolvedValue(true)
    };

    mockNodeRegistry = {
      discoverNodes: jest.fn().mockResolvedValue([
        { nodeId: 'node1', status: NodeStatus.AVAILABLE },
        { nodeId: 'node2', status: NodeStatus.AVAILABLE },
        { nodeId: 'node3', status: NodeStatus.AVAILABLE }
      ]),
      validateNode: jest.fn().mockResolvedValue(true),
      getSuitableRelays: jest.fn().mockResolvedValue([{ nodeId: 'node4' }]),
      getNodeCapabilities: jest.fn().mockResolvedValue({
        maxBandwidth: 1024 * 1024,
        latency: 100
      })
    };

    monitor = new CircuitMonitor(mockCircuit, mockCircuitBuilder, mockNodeRegistry);
  });

  afterEach(() => {
    monitor.stopMonitoring();
    jest.clearAllMocks();
  });

  test('should start and stop monitoring', () => {
    jest.useFakeTimers();

    const listener = jest.fn();
    monitor.addStatusListener(listener);
    monitor.startMonitoring(1000);

    expect(monitor.healthCheckInterval).toBeTruthy();

    jest.advanceTimersByTime(1000);
    expect(mockNodeRegistry.discoverNodes).toHaveBeenCalled();

    monitor.stopMonitoring();
    expect(monitor.healthCheckInterval).toBeNull();

    jest.useRealTimers();
  });

  test('should handle unhealthy nodes', async () => {
    mockNodeRegistry.discoverNodes.mockResolvedValueOnce([
      { nodeId: 'node1', status: NodeStatus.AVAILABLE },
      { nodeId: 'node2', status: NodeStatus.BUSY },
      { nodeId: 'node3', status: NodeStatus.AVAILABLE }
    ]);

    const listener = jest.fn();
    monitor.addStatusListener(listener);

    await monitor.checkCircuitHealth();

    expect(listener).toHaveBeenCalledWith(CircuitStatus.DEGRADED, {
      unhealthyNodes: ['node2']
    });
    expect(mockCircuitBuilder.replaceCircuitNode).toHaveBeenCalled();
  });

  test('should rebuild circuit when too many nodes are unhealthy', async () => {
    mockNodeRegistry.discoverNodes.mockResolvedValueOnce([
      { nodeId: 'node1', status: NodeStatus.BUSY },
      { nodeId: 'node2', status: NodeStatus.BUSY },
      { nodeId: 'node3', status: NodeStatus.AVAILABLE }
    ]);

    const listener = jest.fn();
    monitor.addStatusListener(listener);

    await monitor.checkCircuitHealth();

    expect(listener).toHaveBeenCalledWith(CircuitStatus.REBUILDING);
    expect(mockCircuitBuilder.buildCircuit).toHaveBeenCalled();
    expect(mockCircuitBuilder.migrateCircuitData).toHaveBeenCalled();
  });

  test('should calculate health metrics', async () => {
    const metrics = await monitor.getHealthMetrics();

    expect(metrics).toEqual({
      totalNodes: 3,
      healthyNodes: 3,
      averageLatency: 100,
      bandwidth: 1024 * 1024
    });
  });
});
