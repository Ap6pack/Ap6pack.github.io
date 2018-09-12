<?php
$action = (!empty($_POST['btn_submit']) && ($_POST['btn_submit'] === 'Save')) ? 'save_article' : 'show_form';
switch ($action) {
    case 'save_article':
        try {
            $connection = new Mongo();
            $database   = $connection->selectDB('myblogsite');
            $collection = $database->selectCollection('articles');
            $article    = array(
                'title' => $_POST['title'],
                'content' => $_POST['content'],
                'saved_at' => new MongoDate()
            );
            $collection->insert($article);
        }
        catch (MongoConnectionException $e) {
            die("Failed to connect to database " . $e->getMessage());
        }
        catch (MongoException $e) {
            die('Failed to insert data ' . $e->getMessage());
        }
        break;
    case 'show_form':
    default:
}
?>

<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="ie=edge">

    <link rel="stylesheet" href="css/style.css" />
    <title>Blog Post Creator</title>
</head>

<body>
    <div id="contentarea">
        <div id="innercontentarea">
            <h1>Blog Post Creator</h1>
            <?php if ($action === 'show_form'): ?>
            <form action="<?php echo $_SERVER['PHP_SELF'];?>" method="post">
                <h3>Title</h3>
                <p>
                    <input type="text" name="title" id="title/">
                </p>
                <h3>Content</h3>
                <textarea name="content" rows="20"></textarea>
                <p>
                    <input type="submit" name="btn_submit" value="Save" />
                </p>
            </form>
            <?php else: ?>
            <p>
                Article saved. _id:
                <?php echo $article['_id'];?>.
                <a href="blogpost.php">
                    Write another one?</a>
            </p>
            <?php endif;?>
        </div>
    </div>

</body>

</html>