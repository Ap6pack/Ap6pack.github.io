<?php
require 'vendor/autoload.php'; // include Composer's autoloader

$id = $_GET['id'] ?? '';

if (!$id) {
    die('ID is not provided');
}

try {
    // Create a connection to MongoDB
    $client = new MongoDB\Client("mongodb://localhost:27017");
    $collection = $client->myblogsite->articles;

    // Validate ID
    if (!MongoDB\BSON\ObjectId::isValid($id)) {
        throw new Exception('Invalid ID');
    }

    // Find the article
    $article = $collection->findOne(['_id' => new MongoDB\BSON\ObjectId($id)]);

    if (!$article) {
        throw new Exception('Article not found');
    }

} catch (MongoDB\Driver\Exception\Exception $e) {
    die("Failed to connect to database: " . $e->getMessage());
} catch (Exception $e) {
    die($e->getMessage());
}
?>

<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="ie=edge">
    <link rel="stylesheet" href="css/style.css" />
    <title>My Blog Site</title>
</head>

<body>
    <div id="contentarea">
        <div id="innercontentarea">
            <h1>My Blogs</h1>
            <h2><?php echo htmlspecialchars($article['title'], ENT_QUOTES, 'UTF-8'); ?></h2>
            <p><?php echo htmlspecialchars($article['content'], ENT_QUOTES, 'UTF-8'); ?></p>
        </div>
    </div>
</body>

</html>
