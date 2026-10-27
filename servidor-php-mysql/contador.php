<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
$configPath = dirname(__DIR__, 2) . '/periodico-counter-config.php';
// Si el hosting no permite guardar fuera de public_html, ajustar esta ruta
// a un archivo protegido del acceso web (no publicar credenciales).
if (!is_file($configPath)) { http_response_code(503); echo json_encode(['error'=>'Configuración pendiente']); exit; }
$config = require $configPath;
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowed = $config['allowed_origin'];
if ($origin !== $allowed) { http_response_code(403); echo json_encode(['error'=>'Origen no permitido']); exit; }
header('Access-Control-Allow-Origin: ' . $allowed);
header('Vary: Origin');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error'=>'Método no permitido']); exit; }
if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 2048) { http_response_code(413); exit; }
try {
    $body = json_decode(file_get_contents('php://input'), true, 4, JSON_THROW_ON_ERROR);
    $id = $body['visitorId'] ?? null;
    if (!is_string($id) || !preg_match('/^[a-f0-9-]{36}$/i', $id)) { http_response_code(422); echo json_encode(['error'=>'Identificador inválido']); exit; }
    $hash = hash_hmac('sha256', strtolower($id), $config['secret']);
    $pdo = new PDO('mysql:host='.$config['host'].';dbname='.$config['dbname'].';charset=utf8mb4', $config['username'], $config['password'], [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES=>false]);
    $stmt = $pdo->prepare('INSERT IGNORE INTO periodico_visitantes (visitor_hash) VALUES (?)');
    $stmt->execute([$hash]);
    $count = (int)$pdo->query('SELECT COUNT(*) FROM periodico_visitantes')->fetchColumn();
    echo json_encode(['count'=>$count]);
} catch (Throwable $e) {
    error_log('Contador periódico: '.$e->getMessage());
    http_response_code(500);
    echo json_encode(['error'=>'Error interno del contador']);
}
