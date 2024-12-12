import { CircuitChannel } from './circuitChannel';
import { CircuitBuilder, CircuitStatus } from './circuitBuilder';
import { NodeRegistry } from './nodeRegistry';
import { LayeredEncryption } from './crypto';

describe('CircuitChannel', () => {
  let circuitChannel;
  let mockCircuitBuilder;
  let mockCircuit;

  beforeEach(() => {
    mockCircuit = 'test-circuit-id';
    mockCircuitBuilder = {
      getCircuitStatus: jest.fn(),
      sendThroughCircuit: jest.fn(),
      closeCircuit: jest.fn(),
    };
    circuitChannel = new CircuitChannel(mockCircuit, mockCircuitBuilder);
  });

  describe('connect', () => {
    it('should establish connection when circuit is ready', async () => {
      mockCircuitBuilder.getCircuitStatus.mockResolvedValue(CircuitStatus.READY);
      const onOpenMock = jest.fn();
      circuitChannel.onopen = onOpenMock;

      const result = await circuitChannel.connect();

      expect(result).toBe(true);
      expect(circuitChannel.readyState).toBe('open');
      expect(onOpenMock).toHaveBeenCalled();
    });

    it('should handle connection failure', async () => {
      mockCircuitBuilder.getCircuitStatus.mockRejectedValue(new Error('Circuit failed'));
      const onErrorMock = jest.fn();
      circuitChannel.onerror = onErrorMock;

      const result = await circuitChannel.connect();

      expect(result).toBe(false);
      expect(circuitChannel.readyState).toBe('closed');
      expect(onErrorMock).toHaveBeenCalled();
    });
  });

  describe('send', () => {
    beforeEach(async () => {
      mockCircuitBuilder.getCircuitStatus.mockResolvedValue(CircuitStatus.READY);
      await circuitChannel.connect();
    });

    it('should send string data through circuit', async () => {
      const testData = JSON.stringify({ type: 'test' });
      await circuitChannel.send(testData);

      expect(mockCircuitBuilder.sendThroughCircuit).toHaveBeenCalledWith(
        mockCircuit,
        expect.any(Uint8Array)
      );
    });

    it('should send binary data through circuit', async () => {
      const testData = new Uint8Array([1, 2, 3]);
      await circuitChannel.send(testData);

      expect(mockCircuitBuilder.sendThroughCircuit).toHaveBeenCalledWith(
        mockCircuit,
        testData
      );
    });

    it('should handle send errors', async () => {
      mockCircuitBuilder.sendThroughCircuit.mockRejectedValue(new Error('Send failed'));
      const onErrorMock = jest.fn();
      circuitChannel.onerror = onErrorMock;

      await expect(circuitChannel.send('test')).rejects.toThrow('Send failed');
      expect(onErrorMock).toHaveBeenCalled();
    });
  });

  describe('receive', () => {
    beforeEach(async () => {
      mockCircuitBuilder.getCircuitStatus.mockResolvedValue(CircuitStatus.READY);
      await circuitChannel.connect();
    });

    it('should handle received data', async () => {
      const onMessageMock = jest.fn();
      circuitChannel.onmessage = onMessageMock;
      const testData = new Uint8Array([1, 2, 3]);

      await circuitChannel.receive(testData);

      expect(onMessageMock).toHaveBeenCalledWith(expect.objectContaining({
        data: testData
      }));
    });
  });

  describe('close', () => {
    it('should close the circuit channel', async () => {
      const onCloseMock = jest.fn();
      circuitChannel.onclose = onCloseMock;

      circuitChannel.close();

      expect(circuitChannel.readyState).toBe('closed');
      expect(mockCircuitBuilder.closeCircuit).toHaveBeenCalledWith(mockCircuit);
      expect(onCloseMock).toHaveBeenCalled();
    });
  });
});
