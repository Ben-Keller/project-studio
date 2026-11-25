"""Port availability checks distinguish active listeners from closed connections."""

import socket
import unittest

from local_tools_launcher import _can_bind_port


class PortAvailabilityTests(unittest.TestCase):
    def test_unused_port_is_available(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
            server.bind(("127.0.0.1", 0))
            port = server.getsockname()[1]
        self.assertTrue(_can_bind_port("127.0.0.1", port))

    def test_active_listener_is_not_available(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
            server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            server.bind(("127.0.0.1", 0))
            server.listen(1)
            self.assertFalse(_can_bind_port("127.0.0.1", server.getsockname()[1]))

    def test_closed_connection_does_not_block_restarting_server(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
            server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            server.bind(("127.0.0.1", 0))
            server.listen(1)
            port = server.getsockname()[1]
            with socket.create_connection(("127.0.0.1", port), timeout=2) as client:
                connection, _ = server.accept()
                connection.close()
                self.assertEqual(client.recv(1), b"")
        self.assertTrue(_can_bind_port("127.0.0.1", port))


if __name__ == "__main__":
    unittest.main()
