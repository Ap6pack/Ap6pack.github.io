<?php
require 'vendor/autoload.php'; // include Composer's autoloader

try {
    // Create a connection to MongoDB
    $client = new MongoDB\Client("mongodb://localhost:27017");

    // List all databases
    $databases = $client->listDatabases();

    echo '<pre>';
    foreach ($databases as $database) {
        print_r($database);
    }
    echo '</pre>';
} catch (MongoDB\Driver\Exception\Exception $e) {
    // Handle connection error
    die("Error encountered: " . $e->getMessage());
}
?>
